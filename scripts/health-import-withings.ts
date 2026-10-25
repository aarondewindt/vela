import { healthImportMain, importFailed } from './health-import';
healthImportMain('withings').catch(importFailed);
