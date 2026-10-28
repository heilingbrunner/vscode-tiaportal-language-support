# vscode-tiaportal-language-support

Syntax highlighting for text sources exported from Siemens TIA Portal (STEP 7).

![Screenshot of TIA Portal Language Support](https://github.com/heilingbrunner/vscode-tiaportal-language-support/blob/main/assets/screenshot-1.png)

## Languages

| Language                                 | Extensions     | Scope name       |
| ---------------------------------------- | -------------- | ---------------- |
| [SCL](#scl--structured-control-language) | `.scl`         | `source.tia.scl` |
| [AWL / STL](#awl--stl--statement-list)   | `.awl`, `.stl` | `source.tia.awl` |
| [DB](#db--data-block)                    | `.db`          | `source.tia.db`  |
| [UDT](#udt--user-defined-type)           | `.udt`         | `source.tia.udt` |

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

## TIA Block View (XML)

A read-only viewer for blocks exported from TIA Portal as Openness XML (FB, FC, OB). It shows the interface table, block and network titles/comments and the networks:

- **LAD** is drawn as a ladder diagram: contacts (incl. negated and edge), coils (`S`, `R`), OR branches, FB/FC calls with instance and parameters, timers, comparators, math and `Move`. Parts without a dedicated symbol are drawn as a generic box.
- **SCL** and **STL** networks are shown as source text.

Open an `.xml` file with *Reopen Editor With… > TIA Block View*, or run *TIA: Open Block View to the Side*. The setting `tiaBlockView.culture` (for example `de-DE`) selects the language of titles and comments.

Callee block numbers (`%FB1`, `%DB43`) are not part of the export and are not shown.

### Data blocks (`*.db`)

The same view opens TIA data block sources (*Reopen Editor With… > TIA Block View* on a `.db` file): a numbered table with name, data type, start value, retain, accessible/writable/visible/setpoint flags and comment. Start values that are only the type default are greyed, values assigned in the `BEGIN` section are applied, and structs, arrays and UDT members can be expanded. UDTs are looked up in the `*.udt` files of the workspace; a type without a `.udt` file stays a plain row. Instance data blocks show the function block they belong to.

### User-defined types (`*.udt`)

*Reopen Editor With… > TIA Block View* on a `.udt` file shows the table of TIA's type editor: name, data type, default value (type defaults greyed), accessible/writable/visible/setpoint flags, supervision and comment, without sections and without a retain column. Structs, arrays and referenced UDTs can be expanded; referenced types are looked up in the `*.udt` files of the workspace, and the view refreshes when one of them changes.

### SCL sources (`*.scl`)

*Reopen Editor With… > TIA Block View* on an `.scl` file shows the interface table (Input, Output, InOut, Static, Temp, Constant, Return; default values greyed, retain, comments, UDT members expandable) above the code. The code pane has line numbers, syntax highlighting from this extension's SCL grammar, fold markers for `IF`, `CASE`, `FOR`, `WHILE`, `REPEAT`, `REGION` and multi-line comments, and a `REGION` outline on the left that scrolls to (and unfolds) the selected region. If the highlighter cannot be loaded the code is shown as plain text.

### STL sources (`*.awl`, `*.stl`)

The same view opens STL block sources: the interface table above one block per `NETWORK`, each with its title, the comment lines below the title and a numbered, syntax-highlighted listing of the instructions (English or German mnemonics, labels, absolute addresses, block calls). SCL and STL networks inside Openness XML exports are shown the same way.

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