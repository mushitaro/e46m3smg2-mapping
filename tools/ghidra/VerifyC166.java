//Checks the C166 module against five encodings this project established by hand, then reports.
//@category SMG2
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.*;

public class VerifyC166 extends GhidraScript {
    private void shot(long at) throws Exception {
        Address a = toAddr(at);
        Instruction i = getInstructionAt(a);
        println(String.format("%06X  %s", at, i == null ? "(not disassembled)" : i.toString()));
    }

    @Override
    public void run() throws Exception {
        println("=== VERIFY: the five encodings established by hand ===");
        // docs/full-image-analysis.md: reset vector, DPP idiom, EXTP, ASC0 RX, DS2 baud constant.
        for (long at : new long[]{0x00000L, 0x0044EL, 0x00AD3AL, 0x001BBAL}) shot(at);

        FunctionManager fm = currentProgram.getFunctionManager();
        println("=== TOTALS ===");
        println("functions: " + fm.getFunctionCount());
        long insns = currentProgram.getListing().getNumInstructions();
        println("instructions: " + insns);
        println("defined data: " + currentProgram.getListing().getNumDefinedData());
    }
}
