/** @jest-environment node */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

describe('Android host scripts', () => {
  let directory;
  let project;
  let environment;

  function executable(file, body) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o755 });
  }

  function run(script, args = [], overrides = {}) {
    return spawnSync(path.join(project, 'scripts', script), args, {
      cwd: directory,
      env: { ...environment, ...overrides },
      encoding: 'utf8',
    });
  }

  function calls() {
    return fs.existsSync(environment.CALL_LOG)
      ? fs.readFileSync(environment.CALL_LOG, 'utf8')
      : '';
  }

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-host-scripts-'));
    project = path.join(directory, 'checkout with spaces', 'android');
    fs.mkdirSync(path.join(project, 'scripts'), { recursive: true });
    for (const file of ['host-common.sh', 'build.sh', 'deploy.sh']) {
      fs.copyFileSync(path.join(__dirname, file), path.join(project, 'scripts', file));
    }
    const jdk = path.join(directory, 'jdk 17');
    const sdk = path.join(directory, 'sdk with spaces');
    executable(path.join(jdk, 'bin', 'java'), 'echo \'openjdk version "17.0.17"\' >&2');
    executable(path.join(jdk, 'bin', 'javac'), 'exit 0');
    executable(path.join(project, 'gradlew'),
      'printf "gradle:%s\\n" "$@" >> "$CALL_LOG"\nexit "${GRADLE_EXIT:-0}"');
    executable(path.join(sdk, 'platform-tools', 'adb'), `
printf 'adb:%s\\n' "$*" >> "$CALL_LOG"
case "$*" in
  *get-state) exit "${'${ADB_STATE_EXIT:-0}'}" ;;
  *install*) exit "${'${ADB_INSTALL_EXIT:-0}'}" ;;
esac`);
    environment = {
      PATH: process.env.PATH,
      HOME: directory,
      VELA_ANDROID_JAVA_HOME: jdk,
      ANDROID_HOME: sdk,
      CALL_LOG: path.join(directory, 'calls.log'),
    };
    const apk = path.join(project, 'app/build/outputs/apk/debug/app-debug.apk');
    fs.mkdirSync(path.dirname(apk), { recursive: true });
    fs.writeFileSync(apk, 'test fixture');
  });

  afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));

  test('build works outside the checkout and forwards Gradle arguments intact', () => {
    const result = run('build.sh', ['--offline', '-Pexample=value with spaces']);
    expect(result.status).toBe(0);
    expect(calls()).toBe('gradle::app:assembleDebug\ngradle:--offline\ngradle:-Pexample=value with spaces\n');
    expect(result.stdout).toContain('Debug APK:');
  });

  test('deployment checks USB access, builds, installs and launches in order', () => {
    const result = run('deploy.sh');
    expect(result.status).toBe(0);
    expect(calls().split('\n').filter(Boolean)).toEqual([
      'adb:-d get-state',
      'gradle::app:assembleDebug',
      `adb:-d install -r ${project}/app/build/outputs/apk/debug/app-debug.apk`,
      'adb:-d shell am start -W -n space.aarondewindt.vela.companion/.MainActivity',
    ]);
  });

  test('no-build supports explicit serial selection over ANDROID_SERIAL', () => {
    const result = run('deploy.sh', ['--no-build', '--serial', 'phone-2'], { ANDROID_SERIAL: 'phone-1' });
    expect(result.status).toBe(0);
    expect(calls()).not.toContain('gradle:');
    expect(calls()).toContain('adb:-s phone-2 get-state');
  });

  test('deployment honors ANDROID_SERIAL and SDK discovery through the default host location', () => {
    fs.mkdirSync(path.join(directory, 'Android'), { recursive: true });
    fs.renameSync(environment.ANDROID_HOME, path.join(directory, 'Android/Sdk'));
    const result = run('deploy.sh', ['--no-build'], { ANDROID_HOME: '', ANDROID_SERIAL: 'phone-1' });
    expect(result.status).toBe(0);
    expect(calls()).toContain('adb:-s phone-1 get-state');
  });

  test('unavailable device stops deployment before building', () => {
    const result = run('deploy.sh', [], { ADB_STATE_EXIT: '1' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Phone unavailable');
    expect(calls()).toBe('adb:-d get-state\n');
  });

  test('build failure prevents installation', () => {
    const result = run('deploy.sh', [], { GRADLE_EXIT: '7' });
    expect(result.status).toBe(7);
    expect(calls()).not.toContain('install');
  });

  test('installation failure prevents launch', () => {
    const result = run('deploy.sh', ['--no-build'], { ADB_INSTALL_EXIT: '1' });
    expect(result.status).toBe(1);
    expect(calls()).not.toContain('am start');
  });

  test('rejects an explicitly configured incompatible JDK', () => {
    executable(path.join(environment.VELA_ANDROID_JAVA_HOME, 'bin/java'), 'echo \'openjdk version "25.0.4"\' >&2');
    const result = run('build.sh');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('JDK 17 not found');
    expect(calls()).toBe('');
  });

  test('missing APK and malformed options fail without installation', () => {
    fs.rmSync(path.join(project, 'app/build/outputs/apk/debug/app-debug.apk'));
    expect(run('deploy.sh', ['--no-build']).stderr).toContain('Debug APK not found');
    expect(run('deploy.sh', ['--serial']).status).toBe(1);
    expect(run('deploy.sh', ['--unknown']).status).toBe(1);
    expect(calls()).not.toContain('install');
  });
});
