# GetGasCert enabled production update — 2026-08-13

One-shot enabled-to-enabled Worker update. The operation requires exactly one enabled production version at 100%, verifies the current bindings, uploads and verifies the replacement before switching traffic, runs live answer checks, and automatically restores the previous enabled version on any failure. This authorization does not permit future automatic updates.
