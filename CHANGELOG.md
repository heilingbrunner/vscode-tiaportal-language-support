# Change Log

## [Unreleased]

- New read-only **TIA Viewer** for TIA Portal Openness XML exports (FB, FC, OB):
  interface table, block and network titles/comments, LAD networks drawn as ladder
  (contacts, coils, OR branches, calls, timers, comparators, math, `Move`), and
  SCL/STL networks as source text
- Open via "Reopen Editor With… > TIA Viewer" or the command "TIA: Open Viewer to the Side"
- Setting `tiaViewer.culture` selects the language of titles and comments
- The TIA Viewer also opens **data block sources (`*.db`)**: row-numbered table with data type,
  start value (type defaults greyed, `BEGIN` assignments applied), retain, accessible/writable/visible/setpoint
  flags and comments; structs, arrays and UDT members are expandable. UDT members are resolved from
  the `*.udt` files of the workspace. Instance data blocks show the function block they belong to.
  Optimized (`VAR`), non-optimized (`STRUCT`) and single-array data blocks are supported.
- The TIA Viewer also opens **user-defined type sources (`*.udt`)**: the table of TIA's type editor
  (name, data type, default value, flags, supervision, comment; no sections, no retain column) with
  expandable structs, arrays and referenced UDTs, refreshed when a referenced `*.udt` changes.
- The TIA Viewer also opens **SCL sources (`*.scl`)** (function blocks, functions, organization blocks):
  interface table (greyed defaults, retain, comments, UDT members) above the code, which is shown with
  line numbers, syntax highlighting from the extension's SCL grammar, fold markers for
  `IF`/`CASE`/`FOR`/`WHILE`/`REPEAT`/`REGION`/comments and a clickable `REGION` outline.
- The TIA Viewer also opens **STL sources (`*.awl`, `*.stl`)**: interface table plus one numbered,
  syntax-highlighted code pane per `NETWORK`, with the network title and comment (English and German
  mnemonics). SCL and STL networks of Openness XML exports use the same highlighted code pane.
- Interface row numbers now count only the visible rows and update on expand/collapse; struct and UDT
  rows start collapsed.

## [0.0.2]

- Updated extension to version 0.0.2
- repo url fixed

## [0.0.1]

- Initial release