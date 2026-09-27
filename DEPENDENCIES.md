# Vendored dependencies

These are ordinary source files; no git submodules or package download is needed at build/test time. Every retained upstream file is unmodified. `vendor.sha256` records the SHA-256 digest of each file; check it with `sha256sum --check vendor.sha256`. Unused files can be absent from these deliberately partial distributions.

| Directory | Upstream and pinned commit | Retained files |
| --- | --- | --- |
| `lib/v4-core` | [Uniswap/v4-core](https://github.com/Uniswap/v4-core/tree/46c6834698c48bc4a463a86d8420f4eb1d7f3b75), `46c6834698c48bc4a463a86d8420f4eb1d7f3b75` | `src`, `test/utils/CurrencySettler.sol`, licenses |
| `lib/forge-std` | [foundry-rs/forge-std](https://github.com/foundry-rs/forge-std/tree/3e2295d50379faa6c8e9859d51b1f97a69a830d1), `3e2295d50379faa6c8e9859d51b1f97a69a830d1` | `src`, MIT/Apache licenses |
| `lib/openzeppelin-contracts` | [OpenZeppelin v5.1.0](https://github.com/OpenZeppelin/openzeppelin-contracts/tree/69c8def5f222ff96f2b5beff05dfba996368aa79), `69c8def5f222ff96f2b5beff05dfba996368aa79` | ERC20, IERC20, IERC20Metadata, Context, IERC6093, license |
| `lib/solmate` | [transmissions11/solmate](https://github.com/transmissions11/solmate/tree/4b47a19038b798b4a33d9749d25e570443520647), `4b47a19038b798b4a33d9749d25e570443520647` | Owned.sol (v4-core's pinned dependency), license |

File-level SPDX declarations and upstream license texts are retained. Uniswap PoolManager is compiled for local integration tests. Production CNDL uses the OpenZeppelin ERC20 dependency; production OHLCCandleHook imports the v4 interfaces/types/libraries it uses, not the PoolManager deployment implementation or the test routers.
