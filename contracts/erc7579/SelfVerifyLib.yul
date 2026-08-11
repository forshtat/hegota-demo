// Compiled with `solc --strict-assembly --bin SelfVerifyLib.yul` to produce
// SELF_VERIFY_INITCODE in SelfVerifyLib.sol. Verified correct by disassembling every
// instruction (not hand-assembled from scratch, and not trusted from a first compile --
// verbatim's argument evaluation order was empirically confirmed via a distinguishable-
// operand test compile before this file's own APPROVE/SIGPARAM calls were finalized).
object "SelfVerifyLib" {
    code {
        datacopy(0, dataoffset("runtime"), datasize("runtime"))
        return(0, datasize("runtime"))
    }
    object "runtime" {
        code {
            // owner is passed directly by the caller's fallback -- no external lookup.
            let owner := calldataload(0)

            // SIGPARAM(param=0x00, signatureIndex=0) -> resolved signer for signatures[0].
            // verbatim's written argument order is top-to-bottom stack order (empirically
            // confirmed by disassembling a distinguishable-operand test compile):
            // signatureIndex is on top per the opcode's own spec, so it's written first.
            let signer := verbatim_2i_1o(hex"b4", /*signatureIndex*/ 0, /*param*/ 0)

            if eq(signer, owner) {
                // APPROVE -- stack top-to-bottom is [offset, length, scope] (offset on
                // top per the opcode's own spec), written in that same top-to-bottom order.
                verbatim_3i_0o(hex"aa", /*offset*/ 0, /*length*/ 0, /*scope*/ 3)
            }
            revert(0, 0)
        }
    }
}
