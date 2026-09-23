//Disassembles and creates a function at every entry point the repo's own C166 sweep found.
//@category SMG2
import ghidra.app.script.GhidraScript;
import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.listing.*;
import java.util.*;

public class SeedFromSweep extends GhidraScript {

    /**
     * Reads the `"at": N` values out of the seed file.
     *
     * Hand-scanned rather than regex-matched, and not because a regex would be hard: the first
     * version used one, the heredoc that wrote this file collapsed its double backslashes, and
     * `\s` became an illegal escape that failed at compile time. A scanner has nothing to escape.
     * The file is this repo's own output, so its shape is not in question.
     */
    private static List<Long> readSeeds(String text) {
        List<Long> out = new ArrayList<>();
        String key = "\"at\"";
        int i = 0;
        while ((i = text.indexOf(key, i)) >= 0) {
            int j = i + key.length();
            while (j < text.length() && (text.charAt(j) == ':' || text.charAt(j) == ' ')) j++;
            int start = j;
            while (j < text.length() && Character.isDigit(text.charAt(j))) j++;
            if (j > start) out.add(Long.parseLong(text.substring(start, j)));
            i = j;
        }
        return out;
    }

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        String path = args.length > 0 ? args[0] : "/home/kazuh/seeds.json";
        String text = new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get(path)));
        List<Long> ats = readSeeds(text);
        println("seeds read: " + ats.size());

        AddressSet toDo = new AddressSet();
        for (long at : ats) {
            Address a = toAddr(at);
            if (getInstructionAt(a) == null) toDo.add(a);
        }
        println("not yet disassembled: " + toDo.getNumAddresses());

        int applied = 0;
        for (Address a : toDo.getAddresses(true)) {
            DisassembleCommand cmd = new DisassembleCommand(a, null, true);
            if (cmd.applyTo(currentProgram, monitor)) applied++;
        }

        int created = 0, already = 0, unreachable = 0;
        for (long at : ats) {
            Address a = toAddr(at);
            if (getFunctionAt(a) != null) { already++; continue; }
            if (getInstructionAt(a) == null) { unreachable++; continue; }
            if (createFunction(a, null) != null) created++;
        }

        println("=== SEEDING DONE ===");
        println("disassembly commands applied: " + applied);
        println("functions created: " + created);
        println("functions already present: " + already);
        println("seeds that would not disassemble: " + unreachable);
        println("functions total: " + currentProgram.getFunctionManager().getFunctionCount());
        println("instructions total: " + currentProgram.getListing().getNumInstructions());
    }
}
