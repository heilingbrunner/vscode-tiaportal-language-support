# Change Log

## [Unreleased]

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

## [0.0.1]

- Initial release