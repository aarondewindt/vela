import java.security.MessageDigest

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("kotlin-parcelize")
}

android {
    namespace = "space.aarondewindt.vela.companion"
    compileSdk = 36
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "space.aarondewindt.vela.companion"
        minSdk = 29
        targetSdk = 36
        versionCode = 2
        versionName = "0.2.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencyLocking {
    lockAllConfigurations()
}

val samsungSdk = layout.projectDirectory.file("libs/samsung-health-data-api-1.1.0.aar")
val verifySamsungSdk by tasks.registering {
    doLast {
        check(samsungSdk.asFile.isFile) {
            "Samsung Health Data SDK 1.1.0 missing. Download it from " +
                "https://developer.samsung.com/health/data/overview.html and copy libs/samsung-health-data-api.aar " +
                "to android/app/libs/samsung-health-data-api-1.1.0.aar. See docs/ANDROID_HEALTH_VALIDATION.md."
        }
        val sha256 = MessageDigest.getInstance("SHA-256")
            .digest(samsungSdk.asFile.readBytes()).joinToString("") { "%02x".format(it) }
        check(sha256 == "f5d3d83cf00b97d0bb1b1db4da076e861eb1c3e6e704d89a34e68909d2f38654") {
            "Samsung SDK checksum differs from the verified 1.1.0 artifact. See docs/ANDROID_HEALTH_VALIDATION.md."
        }
    }
}
tasks.named("preBuild").configure { dependsOn(verifySamsungSdk) }

dependencies {
    implementation("androidx.work:work-runtime-ktx:2.10.1")
    implementation(files(samsungSdk))
    implementation("com.google.code.gson:gson:2.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation(platform("androidx.compose:compose-bom:2025.12.00"))
    implementation("androidx.activity:activity-compose:1.12.4")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.12.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
}
