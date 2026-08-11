// Compiled with `solc --strict-assembly --bin MinimalERC7579AccountProxy.yul` to produce the
// PROXY_TEMPLATE hex embedded in MinimalERC7579AccountProxyFactory.sol -- not deployed
// directly by Hardhat (no matching artifact), and not meant to be edited without recompiling
// and re-verifying the resulting hex's byte offsets (28 for the DELEGATECALL target, 65 for
// the appended owner) still match what that factory patches.
//
// The DELEGATECALL target (0x1111...) and the appended "owner" data (20 zero bytes) are both
// placeholders the factory overwrites per-deployment (mstore8, not a single mstore -- see the
// factory's own comment on why) -- this file is never deployed with those bytes as-is.
object "MinimalERC7579AccountProxy" {
    code {
        let rSize := datasize("runtime")
        let oSize := datasize("owner")
        datacopy(0, dataoffset("runtime"), rSize)
        datacopy(rSize, dataoffset("owner"), oSize)
        return(0, add(rSize, oSize))
    }
    object "runtime" {
        code {
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), 0x1111111111111111111111111111111111111111, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            if iszero(ok) { revert(0, returndatasize()) }
            return(0, returndatasize())
        }
    }
    data "owner" hex"0000000000000000000000000000000000000000"
}
