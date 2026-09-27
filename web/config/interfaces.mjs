import { parseAbi } from 'viem'
const pool = 'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }'
export const interfaces = {
  StateView: parseAbi(['function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)', 'function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)']),
  Quoter: parseAbi([pool, 'struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }', 'function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut, uint256 gasEstimate)']),
  PoolSwapTest: parseAbi([pool, 'struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }', 'struct TestSettings { bool takeClaims; bool settleUsingBurn; }', 'function manager() view returns (address)', 'function swap(PoolKey key, SwapParams params, TestSettings testSettings, bytes hookData) payable returns (int256 delta)']),
}
