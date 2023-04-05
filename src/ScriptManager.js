const robot = require("robotjs");
const cac = require("../index");
const keys = [
    "backspace", "delete", "enter", "tab", "escape", "up", "down", "right", "left", "home", "end", "pageup", "pagedown", "f1", "f2", "f3", "f4",
    "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12", "command", "alt", "control", "shift", "right_shift", "space", "printscreen", "insert",
    "audio_mute", "audio_vol_down", "audio_vol_up", "audio_play", "audio_stop", "audio_pause", "audio_prev", "audio_next", "audio_rewind",
    "audio_forward", "audio_repeat", "audio_random", "numpad_0", "numpad_1", "numpad_2", "numpad_3", "numpad_4", "numpad_5", "numpad_6",
    "numpad_7", "numpad_8", "numpad_9", "lights_mon_up", "lights_mon_down", "lights_kbd_toggle", "lights_kbd_up", "lights_kbd_down"
];

const scriptPermissions = {};
const scripts = new Map;
let terminalMessages = [];
const commands = [];
const EventEnd = {event: "end"};
const EventClear = {event: "clear"};
const EventScript = () => ({event: "scripts", scripts: Array.from(scripts).map(i => i[0])});
const registerCommand = (name, handler, description, usage) => {
    commands.push({
        name: Array.isArray(name) ? name[0].toLowerCase() : name.toLowerCase(),
        handler,
        description,
        usage,
        aliases: Array.isArray(name) ? name.map(i => i.toLowerCase()) : []
    });
};
const findCommand = name => commands.find(i => i.name === name.toLowerCase() || i.aliases.includes(name.toLowerCase()));

const eventLoop = async name => {
    if (!scripts.has(name)) return;
    const scr = scripts.get(name);
    await tickScript(scr.code.split("\n"), name, scr.variables);
    setTimeout(() => eventLoop(name));
};

const vr = (str, vars) => {
    return str.replaceAll("$$n", "\n").replaceAll("$$s", " ").replaceAll(/\$[a-zA-Z][a-zA-Z\d]*/g, match => {
        const s = match.trim().substring(1);
        console.log(match, s, vars[s]);
        if (vars[s] !== undefined) return vars[s];
        return match;
    });
};

const parseUsage = usage => usage.map(i => `[${i[0]}]`).join(" ") + "\n" + usage.map(i => `  ${i[0]} - ${i[1]}`).join("\n");

/**
 * @param lines
 * @param name
 * @param variables
 */
const tickScript = async (lines, name = -1, variables) => {
    const script = scripts.get(name);
    const increaseIndex = () => {
        if (!script) return terminalMessages.push(EventEnd);
        if (script.index === lines.length - 1) {
            script.onEnd();
            scripts.delete(name);
            terminalMessages.push(EventScript());
        } else script.index++;
    };
    const line = (script ? lines[script.index] : lines[0]).trimStart();
    if (!line || line[0] === "#" || line[0] + line[1] === "//") return increaseIndex();
    const arg = line.split(" ");
    const cmd = findCommand(arg[0]);
    let result = [];
    let usageError = false;
    let clearing = false;
    let indexUpdated = false;
    const prefix = script ? name + "#" + (script.index + 1) + " > " : "";
    if (cmd) await cmd.handler(arg.slice(1), {
        res: r => result.push([r, false]),
        err: r => result.push([r, true]),
        setIndex: r => {
            if (!script) return;
            script.index = r;
            indexUpdated = true;
        },
        clear: () => clearing = true,
        currentIndex: () => script ? script.index : 0,
        lines,
        variables,
        sendUsage: () => usageError = true,
        isTerminal: () => !script,
        scriptName: name
    }, arg[0]);
    else result.push([prefix + "'" + arg[0] + "' is not recognized as an internal command. Try using command 'help'", true]);
    if (usageError) result.push([prefix + "Invalid usage!\n\n" + cmd.name + " " + parseUsage(cmd.usage), true]);
    if (clearing) terminalMessages.push(EventClear);
    terminalMessages.push(...result.map(i => prefix + i[0]));
    if (result.some(i => i[1]) && script) {
        script.onEnd();
        scripts.delete(name);
        terminalMessages.push(EventScript());
        return;
    }
    if (indexUpdated) return;
    increaseIndex();
};

registerCommand("run", async (args, {res, err, scriptName, isTerminal}) => {
    const files = args.map(i => i.trim()).filter(i => i);
    if (!files.length) return;
    if (files.includes(scriptName)) return err("A script file cannot run itself.");
    if (scripts[scriptName]) return err("This script is already running: " + scriptName);
    const fn = files.find(i => files.filter(j => j === i).length > 1);
    if (fn) return err("Cannot run the same file more than once: " + fn);
    const cac = require("../index").cache();
    const scriptNames = Object.keys(cac.scripts);
    const nm = files.find(i => !scriptNames.includes(i));
    if (nm) return err("Invalid script: " + nm);
    terminalMessages.push(EventScript())
    let _pr;
    const prom = new Promise(r => _pr = r);
    let activeScripts = new Set;
    files.forEach(name => {
        const scr = {
            code: cac.scripts[name].code,
            index: 0,
            variables: {},
            onEnd: () => {
                activeScripts.delete(scr);
                if (activeScripts.size === 0) _pr();
            }
        };
        scripts.set(name, scr);
        terminalMessages.push(EventScript());
        eventLoop(name);
    });
    await prom;
}, "Runs script file(s).", [
    ["script", "the name of the script"]
]);

registerCommand(["help", "?"], (args, {res, err}) => {
    const target = args[0];
    if (target) {
        const cmd = findCommand(target);
        if (!cmd) return err("This command is not supported by the help utility.");
        res(cmd.description);
        res("");
        res(cmd.name + " " + parseUsage(cmd.usage));
    } else {
        res("For more information on a specific command, type 'help command-name'\n");
        const longest = commands.map(i => i.name.length).sort((a, b) => b - a)[0];
        commands.forEach(i => res(i.name + " ".repeat(longest - i.name.length + 3) + i.description));
    }
}, "Provides help information for Neet commands.", [
    ["command", "the name of the command"]
]);

registerCommand(["clear", "cls"], (args, {err, clear, isTerminal}) => {
    if (!isTerminal()) return err("Clearing is only allowed in the terminal.");
    clear();
}, "Clears the terminal.", []);

registerCommand("goto", (args, {err, sendUsage, setIndex, currentIndex, isTerminal}) => {
    const index = vr(args[0]) * 1;
    if (isTerminal()) return err("Altering line index is only allowed in scripts.");
    if (isNaN(index) || index !== Math.floor(index) || index < 1) return sendUsage();
    if (index === currentIndex()) return err("You cannot go to the same line!", true);
    setIndex(index);
}, "Goes to a line in the script.", [
    ["line", "The target line"]
]);

registerCommand("visit", async (args, {err, sendUsage, currentIndex, lines, isTerminal, scriptName, variables}) => {
    const index = vr(args[0]) * 1;
    if (isTerminal()) return err("Running line is only allowed in scripts.");
    if (isNaN(index) || index !== Math.floor(index) || index < 1) return sendUsage();
    if (index === currentIndex()) return err("You cannot visit the same line!");
    await tickScript(lines, scriptName, variables);
}, "Runs a line in the script immediately.", [
    ["line", "The target line"]
]);

registerCommand("print", async (args, {res}) => {
    const str = vr(args.join(" "));
    res(str);
}, "Prints out a text.", [
    ["message", "the message to print"]
]);

registerCommand("wait", async (args, {sendUsage}) => {
    const delay = vr(args[0]) * 1;
    if (isNaN(delay)) return sendUsage();
    await new Promise(r => setTimeout(r, delay * 1000));
}, "Stops the process for the given time.", [
    ["delay", "The delay in seconds"]
]);

registerCommand("if", async (args, {res, err, sendUsage, variables, scriptName}) => {
    const n1 = args[0];
    const st = args[1];
    const n2 = args[2];
    const code = args.slice(3).join(" ").trim();
    if (!n1 || n1[0] !== "$" || !["==", "!=", ">", "<", ">=", "<="].includes(st) || !n2 || n2[0] !== "$") return sendUsage();
    const var1 = variables[n1.substring(1)];
    if (!var1) return err("Invalid variable: " + n1.substring(1));
    if (var1.type !== "string") return err("Expected variable " + n1.substring(1) + " to be string. Got: " + var1.type);
    const var2 = variables[n2.substring(1)];
    if (!var2) err("Invalid variable: " + n2.substring(1));
    if (var2.type !== "string") return err("Expected variable " + n2.substring(1) + " to be string. Got: " + var2.type);
    let val1 = var1.value;
    let val2 = var2.value;
    if ([">", "<", ">=", "<="].includes(st)) {
        val1 *= 1;
        val2 *= 1;
        if (isNaN(val1)) return err("Expected variable " + n1.substring(1) + " to have a numerical value.");
        if (isNaN(val2)) return err("Expected variable " + n2.substring(1) + " to have a numerical value.");
    }
    let result;
    switch (st) {
        case "==":
            result = val1 === val2;
            break;
        case "!=":
            result = val1 !== val2;
            break;
        case ">":
            result = val1 > val2;
            break;
        case "<":
            result = val1 < val2;
            break;
        case ">=":
            result = val1 >= val2;
            break;
        case "<=":
            result = val1 <= val2;
            break;
        default:
            return err("what just happened? report this if somehow happens.");
    }
    if (result) {
        if (code) await tickScript([code], scriptName, variables);
        else res("1");
    } else if (!code) res("0");
}, "Checks if statement is true, and if it is, runs the code immediately.", [
    ["variable1", "A variable. In format of: $variableName"],
    ["comparator", "The comparator. " + `Can be:
    == Checks if two values are equal
    != Checks if two values are not equal
    >  Checks if the first value is bigger than the second value
    <  Checks if the first value is smaller than the second value
    >= Checks if the first value is bigger than or equal to the second value
    <= Checks if the first value is smaller than or equal to the second value
`],
    ["variable2", "A variable. In format of: $variableName"],
    ["code", "This code will be ran if the statement was correct"]
]);

// DONE $$n(new line)
// DONE $$s(space)
// DONE PRINT      text: string
// DONE RUN        ...scripts: string
// DONE GOTO       line: number
// DONE VISIT           line: number
// DONE IF              v1 comparator: ==,!=,>,<,>=,<= v2 code
// TODO ISNUMERIC       text: string
// TODO VAR             v value: string
// TODO DELETEVAR       name: string
// TODO OPERATION       v1 operator: +,-,*,/,**,>>,<<,% v2 result: v3
// TODO MATH            abs/floor/ceil/sqrt... variable
// TODO RANDOM          number1/var1 number2/var2 variable
// TODO RANDOMF         float1/var1 float2/var2 variable
// TODO READLINE        v
// TODO READKEY         v
// TODO CONCAT          v1 v2

// TODO ASSIGN v code: string

// TODO CLICK           right/left/v1 double/single/v2
// TODO MOVE            x: float y: float speed?: float
// TODO DRAG            x: float y: float
// TODO SCROLL          x: float y: float
// TODO POSITION        v1 v2
// TODO PIXEL           x: float y: float v
// TODO SCREENSIZE      v1 v2
// TODO MOUSEDELAY      seconds: float
// TODO KEYBOARDDELAY   seconds: float
// TODO TYPE            text: string cpm?: float
// TODO KEYTAP          key: string ...modifiers: alt, command, control, shift
// TODO KEYDOWN         key: string ...modifiers: alt, command, control, shift
// TODO KEYUP           key: string ...modifiers: alt, command, control, shift

// TODO ISKEYDOWN       key: string
// TODO HASPRESSED      key: string
// TODO HOTKEY          ...keys: string

// DONE WAIT            seconds: float
// TODO VARTYPE         type: "string" | "list" | "object"

// TODO LIST CREATE     v ...values: string
// TODO LIST ADD        v value: string
// TODO LIST RM         v value: string
// TODO LIST RMINDEX    v index: number
// TODO LIST GET        v index: number
// TODO LIST INDEXOF    v value: string
// TODO LIST HAS        v index: number
// TODO LIST LENGTH     v
// TODO LIST SLICE      v vAssign index1: number index2: number

// TODO OBJ CREATE      v
// TODO OBJ SET         v key: string value: string
// TODO OBJ RMKEY       v key: string
// TODO OBJ GET         v key: string
// TODO OBJ HAS         v key: string
// TODO OBJ KEYS        v vAssign
// TODO OBJ VALUES      v vAssign
// TODO OBJ SIZE        v

// TODO DATA GET        key: string
// TODO DATA SET        key: string value: string
// TODO DATA LIST       vAssign

// TODO TIME
// TODO STOP

// TODO FILEWRITE       file: string content: string
// TODO FILEREAD        file: string content: string

// TODO PERM ADD        permission: string script: string
// TODO PERM RM         permission: string script: string
// TODO PERM LIST       script: string

// TODO FOREACH         v vInd vVal code: string
// TODO REPEAT          v from: number to: number code: string


let terminalVariables = {};

module.exports = {
    scripts, msg: () => {
        const m = [...terminalMessages];
        terminalMessages = [];
        return m;
    }, prompt: async str => await tickScript([str], -1, terminalVariables),
    stop: n => {
        if (n) {
            if (terminalMessages[terminalMessages.length - 1] !== EventEnd || scripts.size === 1) terminalMessages.push(EventEnd);
            scripts.delete(n);
            terminalMessages.push(EventScript());
        } else {
            if (terminalMessages[terminalMessages.length - 1] !== EventEnd || scripts.size !== 0) terminalMessages.push(EventEnd);
            scripts.clear();
            terminalMessages.push(EventScript());
        }
    }
};