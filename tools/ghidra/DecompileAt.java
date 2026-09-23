//Decompiles the functions named in the arguments and writes the C to /home/kazuh/decomp/.
//@category SMG2
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import java.io.*;
import java.nio.file.*;

public class DecompileAt extends GhidraScript {
    @Override
    public void run() throws Exception {
        Path out = Paths.get("/home/kazuh/decomp");
        Files.createDirectories(out);
        DecompInterface d = new DecompInterface();
        d.setOptions(new DecompileOptions());
        d.openProgram(currentProgram);
        for (String arg : getScriptArgs()) {
            long at = Long.parseLong(arg, 16);
            Function f = getFunctionContaining(toAddr(at));
            if (f == null) { println("no function at " + arg); continue; }
            DecompileResults res = d.decompileFunction(f, 300, monitor);
            if (!res.decompileCompleted()) { println("decompile failed " + arg + ": " + res.getErrorMessage()); continue; }
            String c = res.getDecompiledFunction().getC();
            Files.write(out.resolve(arg + ".c"), c.getBytes("UTF-8"));
            println("wrote " + arg + ".c  chars=" + c.length() + "  body=" + f.getBody().getNumAddresses());
        }
        d.dispose();
    }
}
