# Change Log

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
