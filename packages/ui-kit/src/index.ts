// @vostok/ui-kit, framework-free components + design tokens for every Vostok Labs app.
// Import styles once per app:  import '@vostok/ui-kit/styles.css'

export { toast, type ToastKind, type ToastOptions } from './components/toast';
export { dialog, type DialogOptions, type DialogHandle, type DialogAction } from './components/dialog';
export {
  licenseNudge,
  openCommercialModal,
  openLicenseModal,
  licenseReminderToast,
  type LicenseModalOptions,
  type LicenseNudgeOptions,
} from './components/license';
export { topbarLinks, type TopbarLinksOptions } from './components/topbar-links';
export { resolveTheme, applyTheme, themeToggleButton, type ThemeToggleOptions } from './components/theme';
export {
  generatorHeader,
  qualityCallout,
  projectActions,
  type GeneratorHeaderOptions,
  type QualityCalloutOptions,
  type ProjectActionsOptions,
} from './components/generator-chrome';
export { sidebarFooter, type SidebarFooterOptions } from './components/sidebar-footer';
export { showWhatsNew, maybeShowWhatsNew, type WhatsNewItem, type WhatsNewOptions } from './components/whats-new';
export { supportLinks } from './components/support-links';
export { exportPanel, buildExportMetadata, type ExportFormat, type ExportPanelOptions } from './components/export-panel';
export { captureCover, type RendererLike } from './components/cover-image';
export { offlineDownloadButton, type OfflineDownloadOptions } from './components/offline-download';
export { encodeParamsToHash, readParamsFromHash, presetShareButton } from './components/preset-share';
export {
  toggleSwitch,
  sliderRow,
  segmentedControl,
  selectField,
  helpTip,
  type ToggleOptions,
  type SliderOptions,
  type SegmentedOption,
  type SegmentedOptions,
  type SelectFieldOptions,
} from './components/controls';
export { dpad, type DpadOptions, type DpadHandle } from './components/dpad';
export { ICONS, svgEl } from './icons';
export { el } from './dom';

export const UI_KIT_VERSION = '0.1.0';
