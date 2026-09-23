# Fixtures

`Siemens_SMG_II_510_24K.xdf` / `Siemens_SMG_II_510_512K.xdf` — TunerPro definitions for the
E46 M3 SMG II transmission ECU (Siemens SMG2, software 510). Authored by the MS4X Dev Team,
supplied by Olza; see the `<description>` inside each file.

They are checked in because the tests assert on their exact contents: 111 items spanning
`0x32080`..`0x37FF0`, 5,477 defined bytes, and two specific defects the validator must catch.
An assertion against a file the test cannot open is not an assertion.

The two differ **only** in `BASEOFFSET` and the declared region size. That is itself a test:
both must resolve the same logical items, and the 24K variant must map them onto a dump that
starts at 0x32000.
