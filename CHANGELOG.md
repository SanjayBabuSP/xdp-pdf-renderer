# Changelog

## [0.7.0](https://github.com/SanjayBabuSP/xdp-pdf-renderer/compare/v0.6.0...v0.7.0) (2026-11-24)


### Features

* **tests:** implement CI-safe optional Adobe font tests and update documentation ([02e716f](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/02e716f709606e2e5ac47667e4179acc641923b1))

## [0.6.0](https://github.com/SanjayBabuSP/xdp-pdf-renderer/compare/v0.5.0...v0.6.0) (2026-11-24)


### Features

* **tests:** enhance rendering tests for URL break opportunities and rich text metrics ([5fffac8](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/5fffac86f3f0827cae209a7a64716eaa04adf8b7))

## [0.5.0](https://github.com/SanjayBabuSP/xdp-pdf-renderer/compare/v0.4.0...v0.5.0) (2026-11-22)


### Features

* add .gitattributes for LF enforcement and update Dependabot configuration to reduce PR volume ([1d39fbd](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/1d39fbdb4dd2bcb1bef95ab0c3859d9fd8d02f25))
* enhance PDF rendering with abort support and locale handling ([7198024](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/7198024c6ea664439cf202016212bf0074695610))

## [0.4.0](https://github.com/SanjayBabuSP/xdp-pdf-renderer/compare/v0.3.0...v0.4.0) (2026-11-21)


### Features

* add comprehensive layout engines, text rendering pipelines, and XDP parsing features ([d509697](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/d5096972e68c5ab8b399d528ccd56a50813736da))
* add MechanicalSeal Adobe LiveCycle parity plan documentation ([660b44b](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/660b44b137e44adf8922689635da6b505ae51915))
* add ponytail OpenCode plugin and command suite ([36b2c6c](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/36b2c6cebd0dd95c784fe94e583d26a65355e985))
* add rich text parsing, font substitution rules, and exclusive group support ([1c8995e](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/1c8995e6d3db4833f7b6e10346dd7a133fdcc484))
* add template and datasets proxies, picture clause formatting in JS engine, and background fill rendering in PDF renderer ([010b04c](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/010b04cb8b68ffd0e73c61dc2e762d7eef66ff31))
* add XFA scripting engines and Adobe PDF post-processing capabilities ([f726448](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/f7264485b065bd0a0a7aa1544b021af19daeaa03))
* enhance layout calculations and rendering for tables and draw elements ([c108078](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/c108078926528cc00374ccca92aee952bcbb1742))
* enhance layout engine to support new 'lr-tb' layout and improve margin handling ([fc7af91](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/fc7af9154e1e9cd5c58cd5d11a3c3720e4c3738d))
* enhance PDF rendering with document metadata and PDF417 barcode support ([bd9d78c](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/bd9d78ca97832dc5e6b00a8649ffd179a90289ef))
* enhance PDF rendering with improved border styles and font metrics ([1d6de93](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/1d6de934c4a7710905b5b80f34ab078a5d314d68))
* enhance XML parsing and rendering for XFA forms ([a2fe13c](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/a2fe13c07c9bb4be2401eaee24da426307543a30))
* implement mechanical seal Adobe parity with identity reconciliation, value formatting, and embed resolution ([2313880](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/231388059595e578b697a00e881789380791ac37))
* **rendering:** document rendering behavior and improve border handling ([e0f0272](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/e0f0272fb60e1784717b2c9c17694d262242859f))
* **rendering:** enhance font handling and measurement for condensed faces ([7aa07b3](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/7aa07b316c27412fe105f2e341a46344a1284a54))
* **rendering:** enhance font sequence handling and add tests for CJK fonts ([1b0bf9d](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/1b0bf9d29fee6d1ef9525f52318bfb57a4210ec8))
* **scripts:** add redact-facts.py to safely strip sensitive information from JSON outputs ([484e9fc](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/484e9fcf601386343dd0f82a88dfc5d6dc7823bf))
* **tests:** update oracle-kit test to include redactor and additional documentation files ([484e9fc](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/484e9fcf601386343dd0f82a88dfc5d6dc7823bf))


### Bug Fixes

* add repository url to package.json for npm provenance ([a8bc4aa](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/a8bc4aadbacb6b56d698ebb1cdbb9d6f141fa944))
* align release-please config with working reference repo ([6277cd3](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/6277cd38f07f4f3f3fe4a0d548d7cf79c5eaa4c4))
* handle empty complex fields in XML parsing and improve short value validation ([2fb4276](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/2fb4276abe80215f6c688fa452ce636c820203f5))
* pass GITHUB_TOKEN explicitly to release-please-action ([0688df0](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/0688df0645acbd8390e12cb2cd51cbfccd5dd5be))


### Code Refactoring

* remove XDC font metrics and integrate paragraph metrics ([32af170](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/32af1705983ff2d7af8dd6425301e0363e49817e))
* reorganize script lifecycle phases and improve event handling ([bfc7244](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/bfc72446c387c16d1e8b03cdecfc51990c1f08e0))

## [0.2.0](https://github.com/SanjayBabuSP/xdp-pdf-renderer/compare/v0.1.0...v0.2.0) (2026-11-15)


### Features

* add comprehensive layout engines, text rendering pipelines, and XDP parsing features ([d509697](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/d5096972e68c5ab8b399d528ccd56a50813736da))
* add MechanicalSeal Adobe LiveCycle parity plan documentation ([660b44b](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/660b44b137e44adf8922689635da6b505ae51915))
* add ponytail OpenCode plugin and command suite ([36b2c6c](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/36b2c6cebd0dd95c784fe94e583d26a65355e985))
* add rich text parsing, font substitution rules, and exclusive group support ([1c8995e](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/1c8995e6d3db4833f7b6e10346dd7a133fdcc484))
* add template and datasets proxies, picture clause formatting in JS engine, and background fill rendering in PDF renderer ([010b04c](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/010b04cb8b68ffd0e73c61dc2e762d7eef66ff31))
* add XFA scripting engines and Adobe PDF post-processing capabilities ([f726448](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/f7264485b065bd0a0a7aa1544b021af19daeaa03))
* enhance layout calculations and rendering for tables and draw elements ([c108078](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/c108078926528cc00374ccca92aee952bcbb1742))
* enhance layout engine to support new 'lr-tb' layout and improve margin handling ([fc7af91](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/fc7af9154e1e9cd5c58cd5d11a3c3720e4c3738d))
* enhance PDF rendering with document metadata and PDF417 barcode support ([bd9d78c](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/bd9d78ca97832dc5e6b00a8649ffd179a90289ef))
* enhance PDF rendering with improved border styles and font metrics ([1d6de93](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/1d6de934c4a7710905b5b80f34ab078a5d314d68))
* enhance XML parsing and rendering for XFA forms ([a2fe13c](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/a2fe13c07c9bb4be2401eaee24da426307543a30))
* implement mechanical seal Adobe parity with identity reconciliation, value formatting, and embed resolution ([2313880](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/231388059595e578b697a00e881789380791ac37))
* **rendering:** document rendering behavior and improve border handling ([e0f0272](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/e0f0272fb60e1784717b2c9c17694d262242859f))
* **rendering:** enhance font handling and measurement for condensed faces ([7aa07b3](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/7aa07b316c27412fe105f2e341a46344a1284a54))
* **rendering:** enhance font sequence handling and add tests for CJK fonts ([1b0bf9d](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/1b0bf9d29fee6d1ef9525f52318bfb57a4210ec8))
* **scripts:** add redact-facts.py to safely strip sensitive information from JSON outputs ([484e9fc](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/484e9fcf601386343dd0f82a88dfc5d6dc7823bf))
* **tests:** update oracle-kit test to include redactor and additional documentation files ([484e9fc](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/484e9fcf601386343dd0f82a88dfc5d6dc7823bf))


### Bug Fixes

* add repository url to package.json for npm provenance ([a8bc4aa](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/a8bc4aadbacb6b56d698ebb1cdbb9d6f141fa944))
* align release-please config with working reference repo ([6277cd3](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/6277cd38f07f4f3f3fe4a0d548d7cf79c5eaa4c4))
* handle empty complex fields in XML parsing and improve short value validation ([2fb4276](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/2fb4276abe80215f6c688fa452ce636c820203f5))
* pass GITHUB_TOKEN explicitly to release-please-action ([0688df0](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/0688df0645acbd8390e12cb2cd51cbfccd5dd5be))


### Code Refactoring

* remove XDC font metrics and integrate paragraph metrics ([32af170](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/32af1705983ff2d7af8dd6425301e0363e49817e))
* reorganize script lifecycle phases and improve event handling ([bfc7244](https://github.com/SanjayBabuSP/xdp-pdf-renderer/commit/bfc72446c387c16d1e8b03cdecfc51990c1f08e0))

## Changelog

All notable changes to this project will be documented in this file.
