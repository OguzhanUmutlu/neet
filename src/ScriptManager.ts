// noinspection JSUnusedLocalSymbols,JSUnusedGlobalSymbols

const robot = require("robotjs");
const cac = require("../index");
const keys = [
    "backspace", "delete", "enter", "tab", "escape", "up", "down", "right", "left", "home", "end", "pageup", "pagedown", "f1", "f2", "f3", "f4",
    "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12", "command", "alt", "control", "shift", "right_shift", "space", "printscreen", "insert",
    "audio_mute", "audio_vol_down", "audio_vol_up", "audio_play", "audio_stop", "audio_pause", "audio_prev", "audio_next", "audio_rewind",
    "audio_forward", "audio_repeat", "audio_random", "numpad_0", "numpad_1", "numpad_2", "numpad_3", "numpad_4", "numpad_5", "numpad_6",
    "numpad_7", "numpad_8", "numpad_9", "lights_mon_up", "lights_mon_down", "lights_kbd_toggle", "lights_kbd_up", "lights_kbd_down"
];

type TypeTerminalMessage =
    { event: "end" }
    | { event: "clear" }
    | { event: "response", content: string }
    | { event: "error", content: string }
    | { event: "scripts", scripts: string[] }
    | { event: any };
type TypeVariable<T, V> = { type: T, value: V };
type TypeStringVariable = TypeVariable<"string", string>;
type TypeListVariable = TypeVariable<"list", string[]>;
type TypeObjectVariable = TypeVariable<"list", Record<string, string>>;
type TypeAnyVariable = TypeStringVariable | TypeListVariable | TypeObjectVariable;

type TypeScript = {
    code: string,
    index: number,
    variables: Record<string, TypeAnyVariable>,
    onEnd: () => void
};
type TypeCommandHandler = (args: string[], options: {
    print: (text: string) => void,
    res: (text: string) => void,
    err: (text: string) => void,
    setIndex: (index: number) => void,
    clear: () => void,
    currentIndex: () => number,
    lines: string[],
    variables: Record<string, TypeAnyVariable>,
    sendUsage: () => void,
    script: TypeScript | null,
    scriptName: string,
    commandName: string
}) => void;

type TypeCommand = {
    names: string[],
    handler: TypeCommandHandler,
    description: string,
    usage: [string, string][],
    returns: string
};

const scriptPermissions = {};
const scripts: Map<string, TypeScript> = new Map;
let terminalMessages: TypeTerminalMessage[] = [];
const commands: TypeCommand[] = [];
const getScripts = () => Array.from(scripts).map(i => i[0]);

const registerCommand = (name: string | string[], handler: TypeCommandHandler, description: string, usage: [string, string][] = [], returns: string = "") => {
    if (!Array.isArray(name)) name = [name];
    name = name.map(i => i.toLowerCase());
    const existing = commands.map(i => i.names).flat().find(i => name.includes(i));
    if (existing) throw new Error("Existing command: " + existing);
    commands.push({
        names: name,
        handler,
        description,
        usage,
        returns
    });
};
const findCommand = (name: string) => commands.find(i => i.names.includes(name.toLowerCase()));

const eventLoop = async (name: string) => {
    const scr = scripts.get(name);
    if (!scr) return;
    await tickScript(scr.code.split("\n"), name, scr.variables);
    setTimeout(() => eventLoop(name));
};

const vr = (str: string, vars: Record<string, TypeAnyVariable>) => {
    str = str || "";
    return str
        .replaceAll("$$n", "\n")
        .replaceAll("$$s", " ")
        .replaceAll("$#PI", Math.PI.toString())
        .replaceAll("$#E", Math.E.toString())
        .replaceAll(/\$[a-zA-Z][a-zA-Z\d]*/g, (match: string) => {
            const s = match.trim().substring(1);
            console.log(match, s, vars[s]);
            const v = vars[s];
            if (v && v.type === "string") return v.value;
            return match;
        });
};

const parseUsage = (usage: [string, string][]) => usage.map(i => `[${i[0]}]`).join(" ") + "\n" + usage.map(i => `  ${i[0]} - ${i[1]}`).join("\n");

const Terminal = {
    response: (content: string) => terminalMessages.push({event: "response", content}),
    error: (content: string) => terminalMessages.push({event: "error", content}),
    end: () => terminalMessages.push({event: "end"}),
    clear: () => terminalMessages.push({event: "clear"}),
    scripts: () => terminalMessages.push({event: "scripts", scripts: getScripts()})
};

const tickScript = async (lines: string[], name: string = "", variables: Record<string, TypeAnyVariable> = terminalVariables, pseudo = false): Promise<string | null> => {
    const script = name ? scripts.get(name) || null : null;
    const increaseIndex = () => {
        if (pseudo) return null;
        if (!script) {
            Terminal.end();
            return null;
        }
        if (script.index === lines.length - 1) {
            script.onEnd();
            scripts.delete(name);
            Terminal.scripts();
        } else script.index++;
        return null;
    };
    const line = (script ? lines[script.index] : lines[0]).trimStart();
    if (!line || line[0] === "#" || line[0] + line[1] === "//") return increaseIndex();
    const arg = line.split(" ");
    const cmd = findCommand(arg[0]);
    let result: ([string, boolean, boolean][]) = [];
    let usageError = false;
    let clearing = false;
    let indexUpdated = false;
    const prefix = script ? name + "#" + (script.index + 1) + " > " : "";
    if (cmd) {
        await cmd.handler(arg.slice(1), {
            print: r => {
                result.push([r, false, true]);
            },
            res: r => {
                result.push([r, false, false]);
            },
            err: r => {
                result.push([r, true, false]);
            },
            setIndex: r => {
                if (!script) return;
                script.index = r;
                indexUpdated = true;
            },
            clear: () => {
                clearing = true
            },
            currentIndex: () => script ? script.index : 0,
            lines,
            variables,
            sendUsage: () => {
                usageError = true;
            },
            script,
            scriptName: name,
            commandName: arg[0]
        });
        if (usageError) result.push([prefix + "Invalid usage!\n\n" + cmd.names[0] + " " + parseUsage(cmd.usage), true, false]);
        if (clearing) Terminal.clear();
    } else result.push([prefix + "'" + arg[0] + "' is not recognized as an internal command. Try using command 'help'", true, false]);
    for (let i = 0; i < result.length; i++) {
        const r = result[i];
        if (r[1]) Terminal.error(r[0] + (!r[2] ? "\n" : ""));
        else Terminal.response(r[0] + (!r[2] ? "\n" : ""));
    }
    if (result.some(i => i[1]) && script) {
        script.onEnd();
        scripts.delete(name);
        Terminal.scripts();
        return null;
    }
    if (!indexUpdated) increaseIndex();
    return result.map((i, j, a) => i[0] + (i[2] || j === a.length - 1 ? "" : "\n")).join("");
};

registerCommand("run", async (args, {err, scriptName}) => {
    const files = args.map(i => i.trim()).filter(i => i);
    if (!files.length) return;
    if (files.includes(scriptName)) return err("A script file cannot run itself.");
    const fn = files.find(i => files.filter(j => j === i).length > 1);
    if (fn) return err("Cannot run the same file more than once: " + fn);
    const cac = require("../index").cache();
    const scriptNames = Object.keys(cac.scripts);
    const nm = files.find(i => !scriptNames.includes(i));
    if (nm) return err("Invalid script: " + nm);
    Terminal.scripts();
    let _pr: Function;
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
        Terminal.scripts();
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
        res(
            "Command: " + cmd.names[0] +
            "\nDescription: " + cmd.description +
            (cmd.names[1] ? "\nAliases: " + cmd.names.slice(1).join(", ") : "") +
            "\nUsage: " + cmd.names[0] + " " + parseUsage(cmd.usage) +
            "\nReturns: " + (cmd.returns ? cmd.returns : "nothing")
        );
    } else {
        res("For more information on a specific command, type 'help command-name'\n");
        const longest = commands.map(i => i.names[0].length).sort((a, b) => b - a)[0];
        commands.forEach(i => res(i.names[0] + " ".repeat(longest - i.names[0].length + 3) + i.description));
    }
}, "Provides help information for Neet commands.", [
    ["command", "the name of the command"]
]);

registerCommand(["clear", "cls"], (args, {err, clear, script}) => {
    if (script) return err("Clearing is only allowed in the terminal.");
    clear();
}, "Clears the terminal.", []);

registerCommand("goto", (args, {err, sendUsage, setIndex, currentIndex, variables, script}) => {
    const index = parseInt(vr(args[0], variables));
    if (!script) return err("Altering line index is only allowed in scripts.");
    if (isNaN(index) || index < 1) return sendUsage();
    if (index === currentIndex()) return err("You cannot go to the same line!");
    setIndex(index);
}, "Goes to a line in the script.", [
    ["line", "The target line"]
]);

registerCommand("visit", async (args, {err, sendUsage, currentIndex, lines, scriptName, variables, script}) => {
    const index = parseInt(vr(args[0], variables));
    if (!script) return err("Running line is only allowed in scripts.");
    if (isNaN(index) || index !== Math.floor(index) || index < 1) return sendUsage();
    if (index === currentIndex()) return err("You cannot visit the same line!");
    await tickScript(lines, scriptName, variables, true);
}, "Runs a line in the script immediately.", [
    ["line", "The target line"]
]);

registerCommand("print", async (args, {res, variables}) => {
    const str = vr(args.join(" "), variables);
    res(str);
}, "Prints out a text.", [
    ["message", "the message to print"]
], "string");

registerCommand("wait", async (args, {sendUsage, variables}) => {
    const delay = parseInt(vr(args[0], variables));
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
    const var1 = variables[n1];
    if (!var1) return err("Invalid variable: " + n1);
    if (var1.type !== "string") return err("Expected variable " + n1 + " to be string. Got: " + var1.type);
    const var2 = variables[n2];
    if (!var2) err("Invalid variable: " + n2);
    if (var2.type !== "string") return err("Expected variable " + n2 + " to be string. Got: " + var2.type);
    let val1: string | number = var1.value;
    let val2: string | number = var2.value;
    if ([">", "<", ">=", "<="].includes(st)) {
        val1 = parseFloat(val1);
        val2 = parseFloat(val2);
        if (isNaN(val1)) return err("Expected variable " + n1 + " to have a numerical value.");
        if (isNaN(val2)) return err("Expected variable " + n2 + " to have a numerical value.");
    }
    const result = eval("val1 " + st + " val2");
    if (result) {
        if (code) await tickScript([code], scriptName, variables, true);
        else res("1");
    } else if (!code) res("0");
}, "Checks if statement is true, and if it is, runs the code immediately.", [
    ["variable1", "A variable."],
    ["comparator", "The comparator. " + `Can be:
    == Checks if two values are equal
    != Checks if two values are not equal
    >  Checks if the first value is bigger than the second value
    <  Checks if the first value is smaller than the second value
    >= Checks if the first value is bigger than or equal to the second value
    <= Checks if the first value is smaller than or equal to the second value
`],
    ["variable2", "A variable."],
    ["code", "This code will be ran if the statement was correct"]
]);

registerCommand(["var", "let"], async (args, {err, sendUsage, variables}) => {
    const name = vr(args[0], variables);
    const value = vr(args.slice(1).join(" "), variables);
    if (!name || !value) return sendUsage();
    if (!isNaN(parseInt(name[0]))) return err("Variable names cannot start with numbers.");
    variables[name] = {type: "string", value};
}, "Sets a variable's value.", [
    ["name", "Variable name"],
    ["value", "Value of the variable"]
]);

registerCommand(["deletevar", "delvar", "rmvar", "removevar"], async (args, {err, sendUsage, variables}) => {
    const name = vr(args[0], variables);
    if (!name) return sendUsage();
    if (!isNaN(parseInt(name[0]))) return err("Variable names cannot start with numbers.");
    delete variables[name];
}, "Deletes a variable.", [
    ["name", "Variable name"]
]);

registerCommand(["isnumeric", "isnum"], async (args, {res, sendUsage, variables}) => {
    const num = parseInt(vr(args[0], variables));
    if (!args[0]) return sendUsage();
    res(isNaN(num) ? "0" : "1");
}, "Checks if something is numeric.", [
    ["text", "A text"]
], "If is a number 1, unless 0");

registerCommand(["operation", "opr"], async (args, {res, err, sendUsage, variables}) => {
    const num1 = parseFloat(vr(args[0], variables));
    const opr = args[1];
    const num2 = parseFloat(vr(args[2], variables));
    if (isNaN(num1) || !["+", "-", "*", "/", "**", ">>", "<<", "%", "^"].includes(opr) || isNaN(num2)) return sendUsage();
    res(eval("num1 " + opr + " num2"));
}, "Does mathematical operations on numbers.", [
    ["number1", "The first number."],
    ["operator", "The operator" + `Can be:
    + Adds
    - Subtracts
    * Multiplies
    / Divides
    ** Power
    >> Shifts right in binary
    << Shifts left in binary
    % Gets the remainder of the division
    ^ Does XOR action in binary
`],
    ["number2", "The second number."],
], "number");

const MATH_F = [
    "abs", "floor", "round", "ceil", "log", "cos", "sin", "tan", "asin", "acos", "atan", "asinh", "acosh", "atanh", "cbrt", "trunc",
    "sign", "sqrt", "log2", "log10", "fround", "exp", "clz32"
];

registerCommand("math", async (args, {res, err, sendUsage, variables}) => {
    const opr = args[0];
    const num = parseFloat(vr(args[1], variables));
    if (isNaN(num) || !MATH_F.includes(opr)) return sendUsage();
    res(eval("Math." + opr + "(num)"));
}, "Runs mathematical methods on numbers.", [
    ["action", "The operator. Can be: " + MATH_F.join(", ")],
    ["number", "The number."],
], "number");

registerCommand(["random", "rand"], async (args, {res, err, sendUsage, variables}) => {
    const num1 = parseInt(vr(args[0], variables));
    const num2 = parseInt(vr(args[1], variables));
    if (isNaN(num1) || isNaN(num2)) return sendUsage();
    const min = Math.min(num1, num2);
    const max = Math.max(num1, num2);
    res(Math.floor(Math.random() * (max - min + 1)) + min + "");
}, "Generates a random integer between two values(both included).", [
    ["number1", "The first number."],
    ["number2", "The second number."],
], "integer");

registerCommand(["randomf", "randf"], async (args, {res, err, sendUsage, variables}) => {
    const num1 = parseFloat(vr(args[0], variables));
    const num2 = parseFloat(vr(args[1], variables));
    if (isNaN(num1) || isNaN(num2)) return sendUsage();
    const min = Math.min(num1, num2);
    const max = Math.max(num1, num2);
    res(Math.random() * (max - min) + min + "");
}, "Generates a random floating number between two values.", [
    ["float1", "The first floating number."],
    ["float2", "The second floating number."],
], "float");

registerCommand(["substring", "substr"], async (args, {res, err, sendUsage, variables}) => {
    const from = parseFloat(vr(args[0], variables));
    const to = parseFloat(vr(args[1], variables));
    const str = vr(args.slice(2).join(" "), variables);
    if (isNaN(from) || isNaN(to)) return sendUsage();
    res(str.substring(from, to));
}, "Extracts a portion of a string, based on the specified starting and ending indices.", [
    ["start", "The ending index."],
    ["end", "The ending index."],
    ["text", "The text."]
], "string");

registerCommand(["replace", "rpl"], async (args, {res, err, sendUsage, variables}) => {
    const from = vr(args[0], variables);
    const to = vr(args[1], variables);
    const str = vr(args.slice(2).join(" "), variables);
    if (!from || !to) return sendUsage();
    res(str.replace(from, to));
}, "Replaces a single occurrence of a specified text with a new text.", [
    ["from", "The text that will be replaced."],
    ["to", "The text that will be replaced with the 'from'."],
    ["text", "The text."]
], "string");

registerCommand(["replaceall", "rplall"], async (args, {res, err, sendUsage, variables}) => {
    const from = vr(args[0], variables);
    const to = vr(args[1], variables);
    const str = vr(args.slice(2).join(" "), variables);
    if (!from || !to) return sendUsage();
    res(str.replaceAll(from, to));
}, "Replaces all occurrences of a specified text with a new text.", [
    ["from", "The text that will be replaced."],
    ["to", "The text that will be replaced with the 'from'."],
    ["text", "The text."]
], "string");

registerCommand(["assign", "asg"], async (args, {res, err, sendUsage, variables, scriptName}) => {
    const variable = vr(args[0], variables);
    const code = args.slice(1).join(" ");
    if (!variable || !code) return sendUsage();
    const r = await tickScript([code], scriptName, variables, true);
    const v = variables[variable];
    if (v && v.type !== "string") return err("Expected variable " + variable + " to be string. Got: " + v.type);
    if (r) variables[variable] = {
        type: "string", value: r
    };
    res(r ? "1" : "0");
}, "Assigns the variable a result of a code.", [
    ["variable", "The variable's name."],
    ["code", "The code."]
], "If succeeds 1, unless 0");

// DONE $$n(new line)
// DONE $$s(space)
// DONE $#PI
// DONE $#E
// DONE CLEAR
// DONE PRINT      text: string
// DONE RUN        ...scripts: string
// DONE GOTO       line: number
// DONE VISIT           line: number
// DONE IF              v1 comparator: ==,!=,>,<,>=,<= v2 code
// DONE ISNUMERIC       text: string
// DONE VAR             v value: string
// DONE DELETEVAR       name: string
// DONE OPERATION       n1: number operator: +,-,*,/,**,>>,<<,%,^ n1: number
// DONE MATH            abs/floor/ceil/sqrt... n: number
// DONE RANDOM          n1: number n2: number
// DONE RANDOMF         n1: float n2: float
// TODO READLINE
// TODO READKEY
// DONE SUBSTRING       from: number to: number text: string
// DONE REPLACE         from: string to: number text: string
// DONE REPLACEALL      from: string to: number text: string

// DONE ASSIGN          v code: string

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
// TODO EVALJS          text: string

// TODO PERM ADD        permission: string script: string
// TODO PERM RM         permission: string script: string
// TODO PERM LIST       script: string

// TODO FOREACH         v vInd vVal code: string
// TODO REPEAT          v from: number to: number code: string


let terminalVariables = {};

const _msg = () => {
    const m = [...terminalMessages];
    terminalMessages = [];
    return m;
};
const _prompt_ = async (str: string) => await tickScript([str], "", terminalVariables);
const _stop_ = (n: string) => {
    if (n) {
        if (terminalMessages[terminalMessages.length - 1].event !== "end" || scripts.size === 1) Terminal.end();
        scripts.delete(n);
        Terminal.scripts();
    } else {
        if (terminalMessages[terminalMessages.length - 1].event !== "end" || scripts.size !== 0) Terminal.end();
        scripts.clear();
        Terminal.scripts();
    }
};

module.exports = {
    scripts_: scripts,
    msg: _msg,
    prompt_: _prompt_,
    stop_: _stop_
};