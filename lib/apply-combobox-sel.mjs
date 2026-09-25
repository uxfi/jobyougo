/**
 * Option-row CSS selectors for custom dropdowns (react-select, MUI, Ant,
 * Workday, Select2, SmartRecruiters, Google Places…). Kept as a plain string
 * array so callers can join() — COMBOBOX_OPTION_QUERY must still INLINE the
 * same list (Playwright/extension evaluate cannot close over imports).
 */
export const COMBOBOX_OPTION_SEL_PARTS = [
  // ARIA / generic
  '[role="option"]',
  '[role="menuitem"]',
  '[role="menuitemradio"]',
  '[role="treeitem"]',
  '[id*="-option-"]',
  'li[id*="option"]',
  '[part="option"]',
  // react-select / similar
  '[class*="select__option"]',
  '[class*="SelectOption"]',
  '[class*="Select-option"]',
  'li[class*="option"]',
  '[class*="-menu"] li',
  '[class*="menuList" i] > *',
  '[class*="menu-list" i] > *',
  '[class*="listbox" i] [class*="option" i]',
  '[class*="listbox__option" i]',
  '[role="listbox"] li',
  'ul[id*="listbox"] li',
  '[class*="-option" i]',
  '[class*="option-" i]',
  '[class*="menu-item" i]',
  // MUI / Ant / Angular Material
  '[class*="MuiMenuItem"]',
  '[class*="MuiAutocomplete-option"]',
  '[class*="ant-select-item-option"]',
  'mat-option',
  '.ng-option',
  // Radix / cmdk / headless
  '[cmdk-item]',
  '[data-radix-collection-item]',
  '[data-highlighted]',
  '[class*="dropdown-item" i]',
  '[class*="DropdownMenuItem" i]',
  // Select2 / Choices.js / Vue Select / Element Plus
  '.select2-results__option',
  '[class*="select2-results__option"]',
  '.choices__item--choice',
  '[class*="choices__item"]',
  '.vs__dropdown-option',
  '[class*="vs__dropdown-option"]',
  '.el-select-dropdown__item',
  '[class*="el-select-dropdown__item"]',
  // Workday
  '[data-automation-id*="promptOption" i]',
  '[data-automation-id*="option" i]',
  '[data-automation-id$="Option"]',
  // SmartRecruiters oneclick-ui / similar web components
  'spl-option',
  'oc-option',
  '[class*="spl-option" i]',
  '[class*="oneclick" i] [role="option"]',
  // Vuetify-ish list rows inside an open menu
  '[class*="v-list-item" i]',
  // Google Places Autocomplete (Lever / Greenhouse city fields)
  '.pac-item',
];

export const COMBOBOX_OPTION_SEL = COMBOBOX_OPTION_SEL_PARTS.join(', ');

/** Wrappers that mark a field as a closed-option combobox (not free text). */
export const COMBOBOX_WRAPPER_SEL = [
  '[class*="select__container"]',
  '[class*="select-shell"]',
  '[class*="Select-container" i]',
  '[class*="react-select" i]',
  '[class*="Select-control"]',
  'spl-select',
  'oc-select',
  '[class*="oneclick" i]',
  '[class*="ant-select"]',
  '[class*="el-select"]',
  '[class*="MuiSelect"]',
  '[class*="MuiAutocomplete"]',
  '.select2-container',
  '[class*="choices" i]',
  '[data-automation-id*="select" i]',
  '[data-automation-id*="dropdown" i]',
].join(', ');
