import { healthImportMain, importFailed } from './health-import';
healthImportMain('samsung').catch(importFailed);
