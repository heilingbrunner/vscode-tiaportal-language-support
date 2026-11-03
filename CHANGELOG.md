# Change Log

## [Unreleased]

- **Fail-safe data blocks (F-DB)**: an SD format `DATA_BLOCK` flagged `S7_Safety := "TRUE"` (and the Openness
  language name `F_DB`) is recognised as an F-DB. The data block view shows `Language: F-DB` in its header;
  standard data blocks show no language, as before.

- **Absolute addresses like TIA Portal**: operands that name a PLC tag show the tag's address (`%M1.2`,
  `%MW10`), taken from the PLC tag table exports in the workspace. STL networks get an address column on the
  right (literals such as `L 0` are repeated there); in LAD / FBD networks the address stands in small text
  below the operand of contacts and coils and below the operand at a box input. Locals, data block members
  and tags without address show none; the view refreshes when a tag table changes.
- **Block comment of STL / SCL sources**: the `////` lines in front of `BEGIN` are shown under the block title,
  collapsed to their first line like in TIA Portal.

- **Fail-safe languages F-LAD and F-FBD**: Openness XML networks and blocks with the programming language
  `F_LAD` / `F_FBD`, and SD format blocks flagged `S7_Safety := "TRUE"`, are recognised as fail-safe. They are
  drawn like LAD / FBD (ladder with power rail, function block diagram without) and the block header and the
  network heading show `F-LAD` / `F-FBD`. SCL networks of a safety block stay SCL. The `s7dcl` and `fbd`
  grammars highlight the fail-safe instructions (`ESTOP1`, `FDBACK`, `MUTING`, `TWO_H_EN`, `SFDOOR`, `ACK_GL`,
  `ACK_OP`, `F_TON`, `F_TOF`, `F_TP`, `F_CTU`, `F_CTD`, `F_CTUD`).

- **FBD networks drawn as function block diagrams**: networks with the programming language FBD (Openness XML
  and `.s7dcl`) no longer look like ladder logic. There is no power rail, operands sit directly at the box
  pins, `A` / `O` / `X` (`And` / `Or` / `Xor`) are boxes titled `&`, `>=1` and `=1`, and coils are assignment
  boxes (`=`, `S`, `R`, `RET`, `JMP`, `JMPN`); several coils on one rung hang off the same signal. A bare
  `RUNG … END_RUNG` shows as an empty network. LAD networks are drawn as before.
- **Syntax highlighting for FBD** (`syntaxes/fbd.tmLanguage.json`, scope `source.tia.fbd`, language `fbd` for
  `*.fbd`): the SD rung syntax with logic boxes, assignments, instruction boxes and box pins. The TIA Viewer
  uses it for FBD networks it cannot draw.

## [0.0.10]

- **PLC tag tables in the git diff view**: a tag table compared with its previous version now marks the
  differences red (old) and green (new), like blocks do. A tag or user constant that exists in one version only
  is marked as a whole row; for a tag or constant in both versions only the cells that changed are marked. Tags
  are matched by name, so a renamed tag shows as one removed and one added row.
- **Next / previous difference buttons**: while the TIA Viewer shows a comparison, up and down arrows in the
  editor title bar jump to the previous / next difference (wrapping around at the ends), like in the text diff
  editor. They work for blocks, data blocks, SCL / STL code, LAD networks and tag tables, and the other side
  scrolls along. Also available as "TIA: Next Difference" and "TIA: Previous Difference".

## [0.0.9]

- **PLC tag tables in the TIA Viewer**: the Openness XML of a tag table (the *PLC tags* folder) opens like TIA
  Portal's tag table editor, with a Tags tab (name, data type, address, retain, accessible / writable / visible,
  comment) and a User constants tab (name, data type, value, comment). A table that only has constants opens on
  them. Tag tables are not compared in the git diff view yet.
- **Search in project**: a new view that searches the exported sources of a folder like TIA Portal's "Search in
  project". Right-click a folder in the Explorer and choose "TIA: Search in Folder…" (or run "TIA: Search in
  Project…"). It finds names, authors, titles and comments, interface members, program code, the operands of
  LAD networks and the tags and constants of PLC tag tables, with "Find exact match" (whole words), a "Limit search to" tree that narrows the result without
  searching again, results that appear while the search runs, and a Path column such as
  `\Network 3\Program code\Line 12`. Double-click opens the TIA Viewer, Ctrl+double-click the source text.
- **LAD diagrams laid out like TIA Portal**: contact and coil operands are never struck through by a wire any
  more, and the wires bend only where they have to (the second and later branches of a fan-out). Rows leave
  room for the tallest label further along them; box inputs are spaced to fit the contact chains and OR groups
  that feed them, and a chain is moved so that it reaches its pin straight; the parallel branches of a series
  of ORs share their rows instead of stepping down. Measured over a project of 3649 networks: wires through
  operand labels 424 → 0, crossings between unconnected wires 1103 → 0, needless bends 1456 → 0, at about
  1 % more diagram height.
- **`P_TRIG` / `N_TRIG` drawn like TIA Portal**: titled `P_TRIG` / `N_TRIG` with the pins `CLK` and `Q`, and the
  memory bit below the box instead of above it.

## [0.0.8]

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
