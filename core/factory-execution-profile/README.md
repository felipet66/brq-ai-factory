# Factory Execution Profile

`NODE_WEB_PREVIEW_24_V1` is the canonical, immutable contract shared by generation and the fixed
Sandbox helpers. The active profile is `1.1.0` with contract `1.1.0`. Its
`buildSemantics.typeCheck` object owns the zero-diagnostic policy, compiler compatibility settings
and the exact ambient declarations available to generated tests. Generation and Sandbox
projections must derive those values; they must not maintain independent API allowlists.

The package exposes only the active profile, not a runtime version catalog. Historical identities
remain pinned here and in regression fixtures so an existing version is never silently rewritten:

| Profile | Contract | Profile hash                                                       | Sandbox snapshot hash                                              |
| ------- | -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `1.0.0` | `1.0.0`  | `cffc60459d28119fa0e83488ff87ff017d49668ac542002194a40e9342c1c31f` | `75d736b1fc3b102df86c715e62f59c87fff1ca069db604400d98b5a2f13be591` |
| `1.1.0` | `1.1.0`  | `ba54cba53e383deab68a1382422e4dcadb8dc3ed14e903a026e023468dbc8b61` | `b671aed30fd78b4bda4219c00fafd1b056e2a46afe7ea81462a9c74d5c098587` |

The active generation projection is `1.3.0`, with hash
`8e3357a1ca039b9498446d653a06946c06c355be0121019f0c3e47b0518d027c`.
The active Sandbox snapshot contract is `1.1.0`; its hash domain is
`brq-factory-execution-profile:sandbox-snapshot:v2`.
