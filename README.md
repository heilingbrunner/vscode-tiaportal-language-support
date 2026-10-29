# TIA Portal Language Support

Syntax highlighting for text sources exported from Siemens TIA Portal (STEP 7).

![Screenshot of TIA Portal Language Support](https://github.com/heilingbrunner/vscode-tiaportal-language-support/blob/main/assets/screenshot-1.png?raw=true)

## Features

- **Syntax highlighting** for `SCL`, `AWL` / `STL`, `DB`, `UDT` and `S7DCL` sources.
- **`UDT` lookup** from the workspace; views refresh when a file changes.
- **`LAD` networks** drawn as ladder diagrams, with zoom.
- **`SCL` / `STL` code** with line numbers, folding and a `REGION` outline.
- **TIA Viewer**: read-only, TIA-style view of Openness XML and `.db`, `.udt`, `.s7dcl` (with its `.s7res`), `.scl`, `.awl`, `.stl` files.
- **Interface table** with expandable structs, arrays and UDT members.
- **Collapsible networks** (click a network heading, or use the collapse/expand all button in the header, which also folds the interface sections) and a culture setting for titles and comments.
- **git diff**: both versions side by side, red/green marks, synchronized scrolling.

## Languages

| Language                                 | Extensions     | Scope name       |
| ---------------------------------------- | -------------- | ---------------- |
| [SCL](#scl--structured-control-language) | `.scl`         | `source.tia.scl` |
| [AWL / STL](#awl--stl--statement-list)   | `.awl`, `.stl` | `source.tia.awl` |
| [DB](#db--data-block)                    | `.db`          | `source.tia.db`  |
| [UDT](#udt--user-defined-type)           | `.udt`         | `source.tia.udt` |
| S7 Declaration                           | `.s7dcl`       | `source.tia.s7dcl` |

All grammars share the same scope suffix (`.tia`), so one theme rule such as `keyword.control.tia` applies to every language.

### SCL – Structured Control Language

High-level, Pascal-like PLC language for function blocks, functions and organization blocks. This is the base grammar; the other three reuse parts of it.

- Block structure: `FUNCTION_BLOCK`, `FUNCTION`, `ORGANIZATION_BLOCK`, `DATA_BLOCK`, `TYPE` with their `END_` counterparts, the block name, and `REGION` / `END_REGION`.
- Interface sections: `VAR`, `VAR_INPUT`, `VAR_OUTPUT`, `VAR_IN_OUT`, `VAR_TEMP`, `VAR_STAT` with `RETAIN` / `NON_RETAIN` / `CONSTANT`, `STRUCT`, `BEGIN`, and the header lines `TITLE`, `AUTHOR`, `FAMILY`, `NAME`, `VERSION`.
- Pragmas such as `{ S7_Optimized_Access := 'TRUE' }`, including pragmas that span several lines.
- Control flow: `IF`, `CASE`, `FOR`, `WHILE`, `REPEAT`, `EXIT`, `CONTINUE`, `RETURN`, `GOTO`.
- Data types (elementary, `Array`, `String[n]`, `HW_*` and similar) and quoted user types.
- Literals: strings with `$` escapes, based numbers (`16#FF`), typed literals (`T#2s`, `DINT#5`, `LDT#…`), `TRUE` / `FALSE`, numbers, and `0..127` ranges.
- References: local tags (`#name`), global tags (`"name"`), members, `%X0` slice access, built-in functions, named call parameters (`name :=`, `name =>`) and calls to quoted blocks.
- Comments: `//`, `(* … *)` and `(/* … */)`.

### AWL / STL – Statement List

Instruction-list language, one instruction per row. A source file is split into a header and a body:

- **Before `BEGIN`:** the SCL grammar highlights the header, pragmas and `VAR` sections.
- **From `BEGIN` to the `END_*` of the block:** AWL rules apply, and each statement may carry a leading label.

Highlighted in the body:

- `NETWORK` and `TITLE = …` lines.
- Labels (`next:`) and jump targets (`JC next`).
- Instructions in the English and German mnemonic sets, grouped as logic (`A`/`U`, `O`, `X`, `S`, `R`, `=`, `A(` … `)`, word logic), arithmetic, comparison (`==I`, `>R`), load / transfer / convert / shift / timer / counter, jumps, calls (`CALL`, `CC`, `UC`) and program control (`BE`, `OPN`, `MCR(`).
- Operands: absolute addresses (`I0.1`, `MW10`, `DB1.DBX0.0`, `T 5`, `FC 10`), symbolic tags (`"Tag"`, `#local`), registers `AR1` / `AR2`, pointers (`P#M 10.0`) and constants (`L#-5`, `W#16#FF`, `S5T#2s`, `B#(1, 2)`, `TOD#…`).
- Call parameter lists with `:=` and `=>`.
- Comments: `//` and `(* … *)`.

> The mnemonic and operand rules follow the standard S7 instruction set. They have been checked against hand-written samples, not against real exports, so please report anything that is mis-scoped.

### DB – Data Block

Global and instance data blocks (`DATA_BLOCK "Name"` … `END_DATA_BLOCK`).

- Everything from the SCL grammar: header lines, the block-level pragma (`{ S7_Optimized_Access := 'FALSE' }`), `VAR` / `STRUCT` member declarations with their attribute pragmas (`{ ExternalAccessible := 'False'; … }`), types, comments.
- The instantiated function block of an instance DB: the quoted name on its own line, for example `"FB_Motor"`.
- Start values after `BEGIN`: the target path (`Data.Event[3].TimeStamp`) is highlighted as a member, and the value as a literal (`LDT#…`, `DINT#…`, `T#…`, strings).

### UDT – User-Defined Type

PLC data types (`TYPE "Name"` … `END_TYPE`).

- The UDT grammar is the SCL grammar: `TYPE` header, `TITLE`, `VERSION`, nested `STRUCT … END_STRUCT`, member attribute pragmas, quoted UDT references, `Array[a..b] of …`, `String[n]` and comments.
- Initial values in declarations: plain and typed literals (`:= 1.5`, `:= T#2s`, `:= BYTE#16#FF`) and aggregate initializers (`[(1, ()), (2, ())]`, `[8(1.0)]`).

## TIA Viewer

A read-only viewer for TIA Portal exports: Openness XML (`*.xml`) and the text sources `*.db`, `*.udt`, `*.s7dcl`, `*.scl`, `*.awl` and `*.stl`. Open a file with *Reopen Editor With… > TIA Viewer*, or run *TIA: Open Viewer to the Side*. Changes can be compared in the viewer too, see [git diff](#git-diff). The setting `tiaViewer.culture` (for example `de-DE`) selects the language of titles and comments.

### Openness XML (`*.xml`)

Blocks exported as Openness XML (FB, FC, OB). The viewer shows the interface table, block and network titles/comments and the networks:

- **LAD** is drawn as a ladder diagram: contacts (incl. negated and edge), coils (`S`, `R`), OR branches, FB/FC calls with instance and parameters, timers, comparators, math and `Move`. Parts without a dedicated symbol are drawn as a generic box.
- **SCL** and **STL** networks are shown as source text.

Callee block numbers (`%FB1`, `%DB43`) are not part of the export and are not shown.

### Data blocks (`*.db`)

The same view opens TIA data block sources (*Reopen Editor With… > TIA Viewer* on a `.db` file): a numbered table with name, data type, start value, retain, accessible/writable/visible/setpoint flags and comment. Start values that are only the type default are greyed, values assigned in the `BEGIN` section are applied, and structs, arrays and UDT members can be expanded. UDTs are looked up in the `*.udt` files of the workspace; a type without a `.udt` file stays a plain row. Instance data blocks show the function block they belong to.

### User-defined types (`*.udt`)

*Reopen Editor With… > TIA Viewer* on a `.udt` file shows the table of TIA's type editor: name, data type, default value (type defaults greyed), accessible/writable/visible/setpoint flags, supervision and comment, without sections and without a retain column. Structs, arrays and referenced UDTs can be expanded; referenced types are looked up in the `*.udt` files of the workspace, and the view refreshes when one of them changes.

### S7 declaration sources (`*.s7dcl` + `*.s7res`)

TIA Portal V20 and later exports types and blocks as `Name.s7dcl` with the texts in a sibling `Name.s7res` (same folder, same name). Open the `.s7dcl` with *Reopen Editor With… > TIA Viewer*:

- `TYPE` is shown like a `.udt`, `DATA_BLOCK` like a `.db` (also instance data blocks, data blocks on a UDT and array data blocks). Comments, block title and block comment are read from the `.s7res` (the text of the `S7_MLC`, `S7_BlockTitle` and `S7_BlockComment` ids; `tiaViewer.culture` picks the language, `de-DE` is the fallback). Without a `.s7res`, or for an id it does not contain, the id itself is shown.
- `S7_Access` / `S7_Visibility` become the accessible/writable/visible flags, `S7_Setpoint` the setpoint flag, `S7_Optimized`, `S7_StandardRetain` and `VAR RETAIN` the memory layout and retain columns. Start values after `END_VAR` are applied.
- Below the block, a collapsed **Texts (.s7res)** table lists every id of the `.s7res` with its text. Texts that nothing refers to are greyed, ids the source uses that the `.s7res` does not contain are marked red.
- Opening the `.s7res` itself with the TIA Viewer shows the `.s7dcl` it belongs to, so the pair works from either file.
- Types are looked up in the `*.udt` and `*.s7dcl` files of the workspace. The view refreshes when the `.s7dcl` or its `.s7res` changes.
- `FUNCTION_BLOCK`, `FUNCTION` and `ORGANIZATION_BLOCK` show the interface table (like an `.scl` source) above their code. `S7_EditorMode := "SCL"` marks a pure SCL block, shown with line numbers, highlighting and the `REGION` outline. A block with `S7_PreferredLanguage := "LAD"` is shown network by network, each following its own `S7_Language`: SCL networks as highlighted code, LAD networks as their syntax-highlighted source text (`RUNG` / `wire#…`, not drawn as a ladder diagram yet), titles and comments from the `.s7res`.

### SCL sources (`*.scl`)

*Reopen Editor With… > TIA Viewer* on an `.scl` file shows the interface table (Input, Output, InOut, Static, Temp, Constant, Return; default values greyed, retain, comments, UDT members expandable) above the code. The code pane has line numbers, syntax highlighting from this extension's SCL grammar, fold markers for `IF`, `CASE`, `FOR`, `WHILE`, `REPEAT`, `REGION` and multi-line comments, and a `REGION` outline on the left that scrolls to (and unfolds) the selected region. If the highlighter cannot be loaded the code is shown as plain text.

### STL sources (`*.awl`, `*.stl`)

The same view opens STL block sources: the interface table above one block per `NETWORK`, each with its title, the comment lines below the title and a numbered, syntax-highlighted listing of the instructions (English or German mnemonics, labels, absolute addresses, block calls). SCL and STL networks inside Openness XML exports are shown the same way.

## git diff

Open a change of an exported file (`*.db`, `*.udt`, `*.s7dcl`, `*.scl`, `*.awl`, `*.stl`, `*.xml`) from Source Control or the Timeline: both versions are shown in the TIA Viewer side by side, differences are marked red (old version) and green (new version), and both sides scroll together.

**Required**

- A Git repository that contains the exported files, and the built-in Git extension of VS Code.

**Optional**

- A `.gitattributes` file in the repository. TIA Portal writes Windows line endings; pinning them keeps line-ending changes out of the diffs. It is the only setup that was needed in testing:

  ```gitattributes
  # TIA Portal exports: stable line endings, so a diff shows real changes only
  *.db   text eol=crlf
  *.udt  text eol=crlf
  *.scl  text eol=crlf
  *.awl  text eol=crlf
  *.stl  text eol=crlf
  *.xml  text eol=crlf
  ```

  Apply it to files that are already committed with `git add --renormalize .`.

- `workbench.editorAssociations`, only if a change opens as a plain text diff instead of two viewers. It makes the viewer the default editor for these file types (user or workspace `settings.json`):

  ```json
  "workbench.editorAssociations": {
    "*.db": "tia.viewer",
    "*.udt": "tia.viewer",
    "*.scl": "tia.viewer",
    "*.awl": "tia.viewer",
    "*.stl": "tia.viewer",
    "*.xml": "tia.viewer"
  }
  ```

  Use *Reopen Editor With… > Text Editor* to see the plain text diff of a single file again.

The viewer compares a `git:` revision with the file on disk. Staged changes (index vs. `HEAD`) are shown unmarked, and the scroll position is synchronised in pixels, so the sides drift apart when earlier content differs in height.

## Development

`npm run build` bundles the extension (`src/` → `dist/`), `npm test` runs the unit tests in `tests/` (fixtures in `fixtures/`; every XML under the git-ignored `test/Project` is additionally parsed and laid out when present), `npm run typecheck` runs `tsc`. Press F5 to start an Extension Development Host.

The grammars are in `syntaxes/`. `scripts/tokenize.js` tokenizes sample files with them and lists every token that has no scope, plus how often each scope occurs:

```
npm install
npm run tokenize -- --dir <samples> --ext <scl|awl|db|udt> [--strict] [--top 25]
```

- `--dir` defaults to `test/`, which is git-ignored and holds local samples.
- `--strict` exits with code 1 if any token has no scope.

## Resources

### AWL/STL – Statement List

- [STL programming language](https://docs.tia.siemens.cloud/r/en-us/v21/creating-stl-programs-s7-300-s7-400-s7-1500/stl-basics-s7-300-s7-400-s7-1500/stl-programming-language-s7-300-s7-400-s7-1500)
- [STL S7-1500](https://docs.tia.siemens.cloud/r/en-us/v21/stl-s7-1500)
- [Creating STL Programs](https://docs.tia.siemens.cloud/r/en-us/v21/creating-stl-programs-s7-300-s7-400-s7-1500)

### SCL – Structured Control Language

- [SCL Programming Language](https://docs.tia.siemens.cloud/r/en-us/v21/creating-scl-programs/basics-of-scl/programming-language-scl)
- [SCL S7-1200 / S7-1500 / S7-1200 G2](https://docs.tia.siemens.cloud/r/en-us/v21/scl-s7-1200-s7-1500-s7-1200-g2)
- [Creating SCL Programs](https://docs.tia.siemens.cloud/r/en-us/v21/creating-scl-programs)

### UDT – User-Defined Type

- [Declaring PLC Data Types (UDT)](https://docs.tia.siemens.cloud/r/en-us/v21/declaring-plc-data-types-udt)

### DB – Data Block

- [Basic Principles for Programming of Data Blocks](https://docs.tia.siemens.cloud/r/en-us/v21/programming-data-blocks/basic-principles-for-programming-of-data-blocks)