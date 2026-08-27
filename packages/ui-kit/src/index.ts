// @vostok/ui-kit, framework-free components + design tokens for every Vostok Labs app.
// Import styles once per app:  import '@vostok/ui-kit/styles.css'

export { toast, type ToastKind, type ToastOptions } from './components/toast';
export { dialog, closeAllDialogs, promptDialog, type DialogOptions, type DialogHandle, type DialogAction, type PromptOptions } from './components/dialog';
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
  resolveMotion,
  effectiveMotion,
  applyMotion,
  motionToggleButton,
  type MotionPreference,
  type EffectiveMotion,
  type MotionToggleOptions,
} from './components/motion';

export {
  generatorHeader,
  qualityCallout,
  projectActions,
  type GeneratorHeaderOptions,
  type QualityCalloutOptions,
  type ProjectActionsOptions,
} from './components/generator-chrome';
export { sidebarFooter, type SidebarFooterOptions } from './components/sidebar-footer';
export { appShell, type AppShellOptions, type AppShell, type PanelOptions } from './components/app-shell';
export { showWhatsNew, maybeShowWhatsNew, type WhatsNewItem, type WhatsNewOptions } from './components/whats-new';
export {
  openChangelog,
  changelogButton,
  changelogList,
  type ChangeKind,
  type ChangelogChange,
  type ChangelogEntry,
  type ChangelogOptions,
  type ChangelogButtonOptions,
} from './components/changelog';
export { supportLinks } from './components/support-links';
export { exportPanel, buildExportMetadata, type ExportFormat, type ExportPanelOptions } from './components/export-panel';
export { captureCover, type RendererLike } from './components/cover-image';
export {
  FILAMENTS,
  filamentRow,
  contrastRatio,
  luminance,
  type FilamentRowOptions,
} from './components/filament';
export { offlineDownloadButton, type OfflineDownloadOptions } from './components/offline-download';
export { encodeParamsToHash, readParamsFromHash, presetShareButton } from './components/preset-share';
export {
  toggleSwitch,
  slider,
  sliderRow,
  stepperRow,
  segmentedControl,
  selectField,
  setFieldOptions,
  helpTip,
  type ToggleOptions,
  type BareSliderOptions,
  type SliderHandle,
  type SliderOptions,
  type StepperRowOptions,
  type ValueRow,
  type SegmentedOption,
  type SegmentedOptions,
  type SegmentedRow,
  type SelectFieldOptions,
} from './components/controls';
export {
  button,
  iconButton,
  buttonRow,
  type ButtonEmphasis,
  type ButtonOptions,
  type ButtonHandle,
  type IconButtonOptions,
} from './components/button';
export { dpad, type DpadOptions, type DpadHandle } from './components/dpad';
export { section, collapsibleSection, makeCollapsible, type SectionOptions } from './components/section';
export { drawer, closeAllDrawers, type DrawerOptions, type DrawerHandle } from './components/drawer';
export {
  symbolPickerButton,
  openSymbolPicker,
  type SymbolItem,
  type SymbolCategory,
  type SymbolPickerOptions,
} from './components/symbol-picker';
export {
  sourceCards,
  dropZone,
  uploadCta,
  sampleGrid,
  type SourceOption,
  type SourceCards,
  type SourceCardsOptions,
  type DropZoneOptions,
  type UploadCtaOptions,
  type SampleItem,
  type SampleGridOptions,
} from './components/sources';
export {
  modeBar,
  stagePanel,
  stepper,
  stageStatus,
  type ModeOption,
  type ModeBar,
  type ModeBarOptions,
  type StagePanel,
  type StagePanelOptions,
  type Stepper,
  type StepperOptions,
  type StageStatus,
  type StatusKind,
} from './components/stage';
export { ICONS, svgEl } from './icons';
export { el } from './dom';
export { themeColorHex } from './tokens';
export {
  chip,
  emptyState,
  progressBar,
  skeleton,
  checkbox,
  textareaField,
  type ChipOptions,
  type ChipHandle,
  type EmptyStateOptions,
  type ProgressOptions,
  type ProgressHandle,
  type CheckboxOptions,
  type CheckboxHandle,
  type TextareaFieldOptions,
  type TextareaHandle,
  listRow,
  bareIconButton,
  type ListRowOptions,
  type ListRowHandle,
  type BareIconButtonOptions,
  textField,
  numberField,
  type TextFieldOptions,
  type TextFieldHandle,
  type NumberFieldOptions,
  type NumberFieldHandle,
} from './components/elements';
export {
  openMenu,
  closeAllMenus,
  type MenuItem,
  type MenuSeparator,
  type MenuEntry,
  type MenuOptions,
  type MenuHandle,
} from './components/menu';

// Web or desktop. Set once by the host app before any generator mounts; the chrome
// components read it and render nothing when it is 'desktop'.
export { setHostEnv, getHostEnv, isDesktop, renderNothing, noopHandle, type HostEnv } from './host-env';

// The contract a desktop host fulfils for a generator. Type-only: a generator that
// runs on the web never sees an implementation.
export type { DesktopHost, HostFile, HostAsset, HostProject, MountFn, ProjectAdapter } from './desktop-host';

// The runtime half of that contract: every capability, called safely, with the web build's
// behaviour as the fallback. See host-assets.ts for why these are helpers and not a
// paragraph copied into each import handler.
export { rememberImport, rememberBytes, rememberFile, chooseFile, hostAssetUrl, hostMedia } from './host-assets';

// One delegated listener that stops an outbound link navigating a window with no way back.
export { bindExternalLinks } from './external-links';

export const UI_KIT_VERSION = '0.1.0';
