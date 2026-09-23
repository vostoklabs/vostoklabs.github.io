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
export {
  openLicenceOffer,
  openLicenceCertificate,
  type LicenceOfferOptions,
  type LicenceCertificateOptions,
} from './components/lifetime-licence';
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
  panelCredit,
  type PanelCreditOptions,
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
export { exportPanel, setExportNote, buildExportMetadata, type ExportFormat, type ExportPanelOptions } from './components/export-panel';
export { captureCover, type RendererLike } from './components/cover-image';
export {
  FILAMENTS,
  filamentRow,
  paletteRow,
  type PaletteRowOptions,
  colorChip,
  contrastRatio,
  luminance,
  type FilamentRowOptions,
  type ColorChipOptions,
  type ColorChipHandle,
} from './components/filament';
export { offlineDownloadButton, type OfflineDownloadOptions } from './components/offline-download';
export { encodeParamsToHash, readParamsFromHash, presetShareButton } from './components/preset-share';
export {
  toggleSwitch,
  slider,
  sliderRow,
  type SliderRowHandle,
  colorSwatch,
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
  buttonGrid,
  type ButtonEmphasis,
  type ButtonOptions,
  type ButtonHandle,
  type IconButtonOptions,
  type ButtonGridOptions,
} from './components/button';
export {
  historyControls,
  type HistoryControlsOptions,
  type HistoryControlsHandle,
} from './components/history-controls';
export { dpad, type DpadOptions, type DpadHandle } from './components/dpad';
export { nudgePad, type NudgePadOptions, type NudgeAxisOptions, type NudgePadHandle } from './components/nudge-pad';
export { colorPopover, closeColorPopover, type ColorPopoverOptions, type ColorPopoverOption, type ColorPopoverHandle } from './components/color-popover';
export { busyChip, type BusyChipOptions, type BusyChipHandle } from './components/busy-chip';
export { section, collapsibleSection, inlineDisclosure, makeCollapsible, type SectionOptions, type InlineDisclosureOptions } from './components/section';
export { galleryCard, galleryGrid, type GalleryCardOptions, type GalleryCardHandle, type GalleryGridOptions } from './components/gallery';
export { drawer, closeAllDrawers, type DrawerOptions, type DrawerHandle } from './components/drawer';
export { splitDialog, type SplitDialogOptions } from './components/split-dialog';
export {
  openSvgImport,
  svgImportDefaults,
  svgPartLabel,
  type SvgImportMode,
  type SvgImportPart,
  type SvgImportChoice,
  type SvgImportPath,
  type SvgImportTrace,
  type SvgImportOptions,
} from './components/svg-import';
export { flattenSvgStyles } from './svg-styles';
export {
  symbolPickerButton,
  openSymbolPicker,
  type SymbolItem,
  type SymbolCategory,
  type SymbolPickerOptions,
} from './components/symbol-picker';
export {
  fontPicker,
  type FontPickerFont,
  type FontPickerOptions,
  type FontPickerHandle,
} from './components/font-picker';
export { fontCards, type FontCardsOptions, type FontCardsHandle } from './components/font-cards';
export {
  sourceCards,
  dropZone,
  uploadCta,
  sampleGrid,
  thumbGrid,
  thumbTile,
  type SourceOption,
  type SourceCards,
  type SourceCardsOptions,
  type DropZoneOptions,
  type UploadCtaOptions,
  type SampleItem,
  type SampleGridOptions,
  type SampleGridHandle,
  type ThumbGridOptions,
  type ThumbTileOptions,
  type ThumbTileHandle,
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
export { ICONS, svgEl, svgPathEl } from './icons';
export { el } from './dom';
export { themeColorHex, themeColor } from './tokens';
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

// The editor frame — the second house layout, for tools that compose on a 2D canvas rather
// than parametrise one model. See components/editor-shell.ts.
export {
  suiteBar,
  designShell,
  designBody,
  studioView,
  toolRail,
  toolbar,
  statusBar,
  floatingPanel,
  popover,
  closeAllPopovers,
  type SuiteTab,
  type SuiteBarOptions,
  type SuiteBar,
  type DesignShellOptions,
  type DesignShell,
  type DesignBodyOptions,
  type DesignBody,
  type StudioViewOptions,
  type StudioView,
  type ToolRailItem,
  type ToolRailOptions,
  type ToolRail,
  type ToolbarOptions,
  type ToolbarHandle,
  type StatusBarOptions,
  type StatusBar,
  type FloatingPanelOptions,
  type FloatingPanel,
  type PopoverOptions,
  type PopoverHandle,
} from './components/editor-shell';
