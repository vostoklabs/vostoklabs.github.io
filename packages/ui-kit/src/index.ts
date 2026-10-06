// @vostok/ui-kit, framework-free components + design tokens for every Vostok Labs app.
// Import styles once per app:  import '@vostok/ui-kit/styles.css'

export { toast, type ToastKind, type ToastOptions } from './components/toast';
export { dialog, closeAllDialogs, promptDialog, type DialogOptions, type DialogHandle, type DialogAction, type PromptOptions } from './components/dialog';
export { holdModal, type ModalOptions } from './components/modal';
// The build loop and the worker transport. Also importable on its own as
// '@vostok/ui-kit/build-loop', which touches no DOM, for use inside a worker.
export {
  buildLoop,
  workerClient,
  answerRequests,
  NothingBuiltError,
  BuildTimeoutError,
  type BuildLoop,
  type BuildLoopOptions,
  type WorkerClient,
  type WorkerClientOptions,
  type AnswerOptions,
} from './build-loop';
// What a build found: the type, and the rule that an error stops the export. DOM-free like the
// build loop, which runs it inside `settled()` when given `diagnose`.
export { assertExportable, ExportBlockedError, type Diagnostic, type DiagnosticLevel } from './diagnostics';
export { diagnosticsList, type DiagnosticsList } from './components/diagnostics-list';
export {
  licenseNudge,
  openCommercialModal,
  openLicenseModal,
  licenseReminderToast,
  licenseAfterExport,
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
export { THEME_KEY, resolveTheme, applyTheme, themeToggleButton, type ThemeToggleOptions } from './components/theme';
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
export { readProjectFile, markProject, type ProjectShape } from './components/project-file';
export { createStore, type Store, type Listener } from './store';
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
export { captureCover, type RendererLike, type CaptureCoverOptions } from './components/cover-image';
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
  syncControls,
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
export { sideNav, type SideNavItem, type SideNavSection, type SideNavOptions, type SideNavHandle } from './components/side-nav';
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
export { fontChooser, type FontChooserOptions, type FontChooserHandle } from './components/font-chooser';
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
  stageTools,
  stageRow,
  previewBar,
  type PreviewBar,
  type PreviewBarOptions,
  type PreviewBarToggle,
  stageHandle,
  type StageHandle,
  type StageHandleOptions,
  type ModeOption,
  type ModeBar,
  type ModeBarOptions,
  type StagePanel,
  type StagePanelOptions,
  type Stepper,
  type StepperOptions,
  type StageStatus,
  type StageStatusOptions,
  type StatusKind,
} from './components/stage';
// The stage as a framed card (switches over the picture, the picture, strips under it), the zoom
// tools that sit on its picture, and the mm | in choice its lengths are shown in.
export { previewCard, type PreviewCardOptions, type PreviewCard } from './components/preview-card';
export { zoomControl, type ZoomControlOptions, type ZoomControl } from './components/zoom-control';
export { lengthUnits, type LengthUnit, type LengthUnitsOptions, type LengthUnits } from './components/length-units';
export { ICONS, svgEl, svgPathEl } from './icons';
export { el, svgNode } from './dom';
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
  searchField,
  type TextFieldOptions,
  type TextFieldHandle,
  type SearchFieldOptions,
  type SearchFieldHandle,
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
// Settings in categories behind a rail, one open at a time (Laser Studio's editor, the clicker).
export {
  settingsRail,
  type SettingsRailItem,
  type SettingsRailOptions,
  type SettingsRailHandle,
} from './components/settings-rail';
// A grid of keys as they will sit; a tap adds or removes one (the clicker's block layouts).
export { keyMap, type KeyMapOptions, type KeyMapHandle } from './components/key-map';
// Symbols in text, the way Laser Studio puts them there: a field whose symbols sit inline as
// tokens, the inspector a token opens, the Symbols & icons library, and its MIT artwork.
export { symbolTextField, type SymbolTextFieldOptions, type SymbolTextFieldHandle } from './components/symbol-text-field';
export { symbolInspector, type SymbolInspectorOptions, type SymbolInspectorHandle } from './components/symbol-inspector';
export { openSymbolLibrary, type SymbolLibraryEntry, type SymbolLibraryOptions, type SymbolLibraryHandle } from './components/symbol-library';
// THE symbol picker, the window above over every set on the shelf, is its own entry,
// `@vostok/ui-kit/symbols`: it brings the symbol library and the icon font, which only the apps that
// open it should carry.
export { SYMBOL_CATALOG, POPULAR_SYMBOL_IDS, type CatalogSymbol } from './symbols/catalog';
export {
  SYMBOL_FIRST, SYMBOL_LAST, isSymbolChar, hasSymbol, codePointCount, nextSymbolChar, placeSymbol, shiftSymbol,
  type SymbolPlacement, type SymbolTransform,
} from './symbols/rules';
