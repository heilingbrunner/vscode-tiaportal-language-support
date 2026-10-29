# Change Log

## [Unreleased]

- **LAD networks of SD format sources drawn as ladder diagrams**: `RUNG` / `wire#…` networks in `*.s7dcl` are
  shown like the LAD of Openness XML (contacts, coils, boxes with ENO to EN chaining, parallel branches and joins
  by `wire#`, comparators, timers, calls). A network the viewer cannot read still shows its source text.

## [0.0.7]

- **SD format sources in the TIA Viewer**: `*.s7dcl` files (TIA Portal V20+) open in the viewer, with
  the texts of the sibling `*.s7res`. `TYPE` is shown like a `.udt`, `DATA_BLOCK` like a `.db`: comments,
  block title and comment from the `.s7res`, access/visibility/setpoint attributes as flags, retain and
  optimized access from the header, start values after `END_VAR`, instance and array data blocks. UDT
  lookup also covers `*.s7dcl` types. The view refreshes when the `.s7res` changes. Function blocks,
  functions and organization blocks show their interface table and code: `S7_EditorMode := "SCL"` blocks
  like an `.scl` source, `S7_PreferredLanguage := "LAD"` blocks network by network (SCL networks
  highlighted, LAD networks as highlighted source text, using the new s7dcl grammar in the viewer too).
- **Collapse all / Expand all** toggle in the TIA Viewer header: folds or unfolds the interface sections
  (Input, Output, ...) and all networks at once; its icon shows the next action.
- **`*.s7res` in the TIA Viewer**: a collapsed "Texts (.s7res)" table in the `.s7dcl` view lists all texts
  (unused texts greyed, missing ids marked), and opening an `.s7res` with the viewer shows the `.s7dcl`
  it belongs to.
- **Syntax highlighting for `*.s7dcl`** (scope `source.tia.s7dcl`): `{ S7_... := "..." }` attribute blocks,
  `NETWORK` / `RUNG` structure with `wire#` names and ladder instructions, the `_.` global scope and
  `DB_SPECIFIC`; everything else is shared with the SCL grammar.

## [0.0.6]

- **Git diff in the TIA Viewer**: when a changed export is opened from Source Control or the Timeline and
  the TIA Viewer is the editor of both sides, the previous and the current version are shown side by side
  and the differences are marked, old version red and new version green: changed interface cells, added
  and removed members and networks, changed titles and comments, changed code lines and changed LAD
  elements (operands, contacts, coils, boxes, wires). Collapsed rows and sections with changes inside get
  a marker. Both viewers scroll together. See the new "git diff" section of the README (optional
  `.gitattributes` and `workbench.editorAssociations` setup).
- README: new "Features" section.

## [0.0.5]

- Fixed: LAD coils that feed a following element (e.g. a coil followed by a contact) lost the wire
  between them. Every coil now has a trailing wire; a coil that feeds nothing ends in a vertical tick,
  like in TIA Portal.
- LAD blocks: the input pins of a call or box are spaced by the operand labels of the contacts and coils
  feeding them (also through OR branches) instead of a fixed distance, so labels no longer overlap the
  wire above. Contacts fed from the power rail line up with the block pin they drive.

## [0.0.4]

- The **TIA Block View** is now called **TIA Viewer**, because it shows more than blocks. The command is
  "TIA: Open Viewer to the Side". If you set the culture, rename the setting `tiaBlockView.culture` to
  `tiaViewer.culture` (the command id `tia.openBlockView` is now `tia.openViewer`, which matters only for
  custom keybindings).
- The TIA Viewer also opens **user-defined type sources (`*.udt`)**: the table of TIA's type editor
  (name, data type, default value, flags, supervision, comment; no sections, no retain column) with
  expandable structs, arrays and referenced UDTs, refreshed when a referenced `*.udt` changes.
- LAD networks: operands of contacts and coils are wrapped like in TIA Portal, so long operands no longer
  push coils far to the right. The layout also keeps every rung in its own band, no longer draws wires
  through operand labels, avoids crossings between unconnected wires and keeps series chains on one
  straight line instead of bending them.
- Fixed: named constants (`"GlobalConstant"`, `#LocalConstant`) were missing at the pins of calls,
  in array indices (`Array["Index"]` was shown as `Array[]`) and in SCL code.
- Fixed: an SCL network that consists of a block call (FB/FC) showed only `;`; consecutive blank lines in
  SCL networks are kept.
- Interface sections without members are shown in normal font weight, so empty sections can be told apart
  without expanding them.

## [0.0.3]

- New read-only **TIA Block View** for TIA Portal Openness XML exports (FB, FC, OB):
  interface table, block and network titles/comments, LAD networks drawn as ladder
  (contacts, coils, OR branches, calls, timers, comparators, math, `Move`), and
  SCL/STL networks as source text
- Open via "Reopen Editor With… > TIA Block View" or the command "TIA: Open Block View to the Side"
- Setting `tiaBlockView.culture` selects the language of titles and comments
- The TIA Block View also opens **data block sources (`*.db`)**: row-numbered table with data type,
  start value (type defaults greyed, `BEGIN` assignments applied), retain, accessible/writable/visible/setpoint
  flags and comments; structs, arrays and UDT members are expandable. UDT members are resolved from
  the `*.udt` files of the workspace. Instance data blocks show the function block they belong to.
  Optimized (`VAR`), non-optimized (`STRUCT`) and single-array data blocks are supported.
- The TIA Block View also opens **SCL sources (`*.scl`)** (function blocks, functions, organization blocks):
  interface table (greyed defaults, retain, comments, UDT members) above the code, which is shown with
  line numbers, syntax highlighting from the extension's SCL grammar, fold markers for
  `IF`/`CASE`/`FOR`/`WHILE`/`REPEAT`/`REGION`/comments and a clickable `REGION` outline.
- The TIA Block View also opens **STL sources (`*.awl`, `*.stl`)**: interface table plus one numbered,
  syntax-highlighted code pane per `NETWORK`, with the network title and comment (English and German
  mnemonics). SCL and STL networks of Openness XML exports use the same highlighted code pane.
- Interface row numbers now count only the visible rows and update on expand/collapse; struct and UDT
  rows start collapsed.

## [0.0.2]

- Updated extension to version 0.0.2
- repo url fixed
