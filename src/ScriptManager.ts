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
    { event: "input", value: boolean }
    | { event: "clear" }
    | {
    event: "message", message: {
        content: string,
        type: "response" | "error",
        color: string | undefined,
        backgroundColor: string | undefined,
        readonly: boolean
    }
}
    | { event: "scripts", scripts: string[] }
    | { event: any };
type TypeVariable<T, V> = { type: T, value: V };
type TypeStringVariable = TypeVariable<"string", string>;
type TypeListVariable = TypeVariable<"list", string[]>;
type TypeObjectVariable = TypeVariable<"object", Record<string, string>>;
type TypeAnyVariable = TypeStringVariable | TypeListVariable | TypeObjectVariable;

type TypeScript = {
    code: string,
    index: number,
    variables: Record<string, TypeAnyVariable>,
    onEnd: () => void
};
type TypeCommandHandler = (args: string[], options: {
    print: (text: string, color?: string | undefined, backgroundColor?: string | undefined) => void,
    res: (text: string, color?: string | undefined, backgroundColor?: string | undefined) => void,
    err: (text: string, color?: string | undefined, backgroundColor?: string | undefined) => void,
    setIndex: (index: number) => void,
    clear: () => void,
    currentIndex: () => number,
    lines: string[],
    variables: Record<string, TypeAnyVariable>,
    sendUsage: () => void,
    script: TypeScript | null,
    scriptName: string,
    commandName: string,
    assign: (name: string, value: string | string[] | Record<string, string>, type: "string" | "list" | "object") => boolean,
    vr: (text: string) => string
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
const globalVar = (str: string, vars: Record<string, TypeAnyVariable>): string => {
    str = str || "";
    return str
        .replaceAll("$$n", "\n")
        .replaceAll("$$s", " ")
        .replaceAll("$#PI", Math.PI.toString())
        .replaceAll("$#E", Math.E.toString())
        .replaceAll(/\$[a-zA-Z][a-zA-Z\d]*/g, (match: string) => {
            const s = match.trim().substring(1);
            const v = vars[s];
            if (v && v.type === "string") return v.value;
            return match;
        });
};
const parseUsage = (usage: [string, string][]) => usage.map(i => `[${i[0]}]`).join(" ") + "\n" + usage.map(i => `  ${i[0]} - ${i[1]}`).join("\n");
let inputOn = true;
const Terminal = {
    message: (content: string, type: "response" | "error", color?: string | undefined, backgroundColor?: string | undefined, readonly: boolean = true) => terminalMessages.push({
        event: "message",
        message: {content, type, color, backgroundColor, readonly}
    }),
    enableInput: () => {
        if (inputOn) return;
        terminalMessages.push({event: "input", value: true});
        inputOn = true;
    },
    disableInput: () => {
        if (!inputOn) return;
        terminalMessages.push({event: "input", value: false});
        inputOn = false;
    },
    clear: () => terminalMessages.push({event: "clear"}),
    scripts: () => terminalMessages.push({event: "scripts", scripts: getScripts()})
};
const tickScript = async (lines: string[], name: string = "", variables: Record<string, TypeAnyVariable> = terminalVariables, pseudo = false): Promise<string | null> => {
    const script = name ? scripts.get(name) || null : null;
    const increaseIndex = () => {
        if (pseudo) return null;
        if (!script) {
            Terminal.enableInput();
            return null;
        }
        if (script.index === lines.length - 1) {
            script.onEnd();
            scripts.delete(name);
            Terminal.scripts();
        } else script.index++;
        return null;
    };
    const line = (script && !pseudo ? lines[script.index] : lines[0]).trimStart();
    if (!line || line[0] === "#" || line[0] + line[1] === "//") return increaseIndex();
    const arg = line.split(" ");
    const cmd = findCommand(arg[0]);
    let indexUpdated = false;
    let hasError = false;
    let result = "";
    const prefix = script ? name + "#" + (script.index + 1) + " > " : "";
    if (cmd) {
        await cmd.handler(arg.slice(1), {
            print: (r, c, bg) => {
                Terminal.message(r, "response", c, bg);
                result += r;
            },
            res: (r, c, bg) => {
                Terminal.message(prefix + r + "\n", "response", c, bg);
                result += r + "\n";
            },
            err: (r, c = "red", bg) => {
                Terminal.message(prefix + r + "\n", "error", c, bg);
                hasError = true;
            },
            setIndex: r => {
                if (!script) return;
                script.index = r;
                indexUpdated = true;
            },
            clear: () => Terminal.clear(),
            currentIndex: () => script ? script.index : 0,
            lines,
            variables,
            sendUsage: () => {
                Terminal.message(prefix + "Invalid usage!\n\n" + cmd.names[0] + " " + parseUsage(cmd.usage) + "\n", "error", "red");
                hasError = true;
            },
            script,
            scriptName: name,
            commandName: arg[0],
            assign: (name: string, value: any, type: any): boolean => {
                if (!isNaN(parseInt(name[0]))) return false;
                variables[name] = {type, value};
                return true;
            },
            vr: str => globalVar(str, variables)
        });
    } else {
        Terminal.message("'" + arg[0] + "' is not recognized as an internal command. Try using command 'help'\n", "error", "red");
        hasError = true
    }
    if (hasError && script) {
        script.onEnd();
        scripts.delete(name);
        Terminal.scripts();
        return null;
    }
    if (!indexUpdated) increaseIndex();
    return result;
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
        activeScripts.add(scr);
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
            (cmd.names.length > 1 ? "\nAliases: " + cmd.names.slice(1).join(", ") : "") +
            "\nDescription: " + cmd.description +
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

registerCommand("goto", (args, {err, sendUsage, setIndex, currentIndex, vr, script}) => {
    const index = parseInt(vr(args[0]));
    if (!script) return err("Altering line index is only allowed in scripts.");
    if (isNaN(index) || index < 1) return sendUsage();
    if (index - 1 === currentIndex()) return err("You cannot go to the same line!");
    setIndex(index - 1);
}, "Goes to a line in the script.", [
    ["line", "The target line"]
]);

registerCommand("visit", async (args, {err, sendUsage, currentIndex, lines, scriptName, variables, vr, script}) => {
    const index = parseInt(vr(args[0]));
    if (!script) return err("Running line is only allowed in scripts.");
    if (isNaN(index) || index !== Math.floor(index) || index < 1) return sendUsage();
    if (index === currentIndex()) return err("You cannot visit the same line!");
    await tickScript(lines, scriptName, variables, true);
}, "Runs a line in the script immediately.", [
    ["line", "The target line"]
]);

registerCommand("print", async (args, {res, vr}) => {
    const str = vr(args.join(" "));
    res(str);
}, "Prints out a text.", [
    ["message", "the message to print"]
], "string");

registerCommand("wait", async (args, {sendUsage, vr}) => {
    const delay = parseFloat(vr(args[0]));
    if (isNaN(delay)) return sendUsage();
    await new Promise(r => setTimeout(r, delay * 1000));
}, "Stops the process for the given time.", [
    ["delay", "The delay in seconds"]
]);

registerCommand("if", async (args, {res, err, sendUsage, vr, variables, scriptName}) => {
    let n1: string | number = vr(args[0]);
    const st = args[1];
    let n2: string | number = vr(args[2]);
    const code = args.slice(3).join(" ").trim();
    if (!n1 || !["==", "!=", ">", "<", ">=", "<="].includes(st) || !n2) return sendUsage();
    if ([">", "<", ">=", "<="].includes(st)) {
        n1 = parseFloat(n1);
        n2 = parseFloat(n2);
        if (isNaN(n1)) return err("Expected first value to be a numeric.");
        if (isNaN(n2)) return err("Expected second value to be a numeric.");
    }
    const result = eval("n1 " + st + " n2");
    if (result) {
        if (code) await tickScript([code], scriptName, variables, true);
        else res("1");
    } else if (!code) res("0");
}, "Checks if statement is true, and if it is, runs the code immediately.", [
    ["a", "First value."],
    ["comparator", "The comparator. " + `Can be:
    == Checks if two values are equal
    != Checks if two values are not equal
    >  Checks if the first value is bigger than the second value
    <  Checks if the first value is smaller than the second value
    >= Checks if the first value is bigger than or equal to the second value
    <= Checks if the first value is smaller than or equal to the second value
`],
    ["b", "Second value."],
    ["code", "This code will be ran if the statement was correct"]
]);

registerCommand(["var", "let"], async (args, {err, sendUsage, vr, assign}) => {
    const name = vr(args[0]);
    const value = vr(args.slice(1).join(" "));
    if (!name || !value) return sendUsage();
    if (!assign(name, value, "string")) return err("Variable names cannot start with numbers.");
}, "Sets a variable's value.", [
    ["name", "Variable name"],
    ["value", "Value of the variable"]
]);

registerCommand(["deletevar", "delvar", "rmvar", "removevar"], async (args, {err, sendUsage, variables, vr}) => {
    const name = vr(args[0]);
    if (!name) return sendUsage();
    if (!isNaN(parseInt(name[0]))) return err("Variable names cannot start with numbers.");
    delete variables[name];
}, "Deletes a variable.", [
    ["name", "Variable name"]
]);

registerCommand(["isnumeric", "isnum"], async (args, {res, sendUsage, vr}) => {
    const num = parseInt(vr(args[0]));
    res(isNaN(num) ? "0" : "1");
}, "Checks if something is numeric.", [
    ["text", "A text"]
], "If is a number 1, unless 0");

registerCommand(["operation", "opr"], async (args, {res, err, sendUsage, vr}) => {
    const num1 = parseFloat(vr(args[0]));
    const opr = args[1];
    const num2 = parseFloat(vr(args[2]));
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

registerCommand("math", async (args, {res, err, sendUsage, vr}) => {
    const opr = args[0];
    const num = parseFloat(vr(args[1]));
    if (isNaN(num) || !MATH_F.includes(opr)) return sendUsage();
    res(eval("Math." + opr + "(num)"));
}, "Runs mathematical methods on numbers.", [
    ["action", "The operator. Can be: " + MATH_F.join(", ")],
    ["number", "The number."],
], "number");

registerCommand(["random", "rand"], async (args, {res, err, vr, sendUsage}) => {
    const num1 = parseInt(vr(args[0]));
    const num2 = parseInt(vr(args[1]));
    if (isNaN(num1) || isNaN(num2)) return sendUsage();
    const min = Math.min(num1, num2);
    const max = Math.max(num1, num2);
    res(Math.floor(Math.random() * (max - min + 1)) + min + "");
}, "Generates a random integer between two values(both included).", [
    ["number1", "The first number."],
    ["number2", "The second number."],
], "integer");

registerCommand(["randomf", "randf"], async (args, {res, err, sendUsage, vr}) => {
    const num1 = parseFloat(vr(args[0]));
    const num2 = parseFloat(vr(args[1]));
    if (isNaN(num1) || isNaN(num2)) return sendUsage();
    const min = Math.min(num1, num2);
    const max = Math.max(num1, num2);
    res(Math.random() * (max - min) + min + "");
}, "Generates a random floating number between two values.", [
    ["float1", "The first floating number."],
    ["float2", "The second floating number."],
], "float");

registerCommand(["substring", "substr"], async (args, {res, err, sendUsage, vr}) => {
    const from = parseFloat(vr(args[0]));
    const to = parseFloat(vr(args[1]));
    const str = vr(args.slice(2).join(" "));
    if (isNaN(from) || isNaN(to)) return sendUsage();
    res(str.substring(from, to));
}, "Extracts a portion of a string, based on the specified starting and ending indices.", [
    ["start", "The ending index."],
    ["end", "The ending index."],
    ["text", "The text."]
], "string");

registerCommand(["replace", "rpl"], async (args, {res, err, sendUsage, vr}) => {
    const from = vr(args[0]);
    const to = vr(args[1]);
    const str = vr(args.slice(2).join(" "));
    if (!from || !to) return sendUsage();
    res(str.replace(from, to));
}, "Replaces a single occurrence of a specified text with a new text.", [
    ["from", "The text that will be replaced."],
    ["to", "The text that will be replaced with the 'from'."],
    ["text", "The text."]
], "string");

registerCommand(["replaceall", "rplall"], async (args, {res, err, sendUsage, vr}) => {
    const from = vr(args[0]);
    const to = vr(args[1]);
    const str = vr(args.slice(2).join(" "));
    if (!from || !to) return sendUsage();
    res(str.replaceAll(from, to));
}, "Replaces all occurrences of a specified text with a new text.", [
    ["from", "The text that will be replaced."],
    ["to", "The text that will be replaced with the 'from'."],
    ["text", "The text."]
], "string");

registerCommand(["assign", "asg"], async (args, {res, err, sendUsage, variables, vr, scriptName, assign}) => {
    const variable = vr(args[0]);
    const code = args.slice(1).join(" ");
    if (!variable || !code) return sendUsage();
    const r = await tickScript([code], scriptName, variables, true);
    const v = variables[variable];
    if (v && v.type !== "string") return err("Expected variable " + variable + " to be string. Got: " + v.type);
    if (r) assign(variable, r, "string");
}, "Assigns the variable a result of a code.", [
    ["variable", "The variable's name."],
    ["code", "The code."]
]);

registerCommand(["stop", "exit"], async (args, {res, err, script}) => {
    if (!script) return err("Exiting is only allowed in scripts.");
    err("");
}, "Stops the script.");

registerCommand("click", async (args, {res, err, script, vr, sendUsage}) => {
    const button = vr(args[0]) || "left";
    const type = vr(args[1]) || "single";
    if (!["left", "right"].includes(button) || !["single", "double"].includes(type)) return sendUsage();
    robot.mouseClick(button, type === "double");
}, "Clicks the mouse.", [
    ["button", "The mouse button. Can be: left, right. Default: left"],
    ["type", "The click type. Can be: double, single. Default: single"],
]);

registerCommand("move", async (args, {res, err, script, vr, sendUsage}) => {
    const x = parseFloat(vr(args[0]));
    const y = parseFloat(vr(args[1]));
    const speedV = vr(args[2]);
    const speed = parseFloat(speedV);
    if (isNaN(x) || isNaN(y) || (speedV && (isNaN(speed) || speed <= 0))) return sendUsage();
    if (speedV && speed > 10) return err("Move speed cannot be bigger than 10.");
    if (!speedV) robot.moveMouse(x, y);
    else robot.moveMouseSmooth(x, y, speed);
}, "Moves the mouse.", [
    ["x", "The X coordinate to move to."],
    ["y", "The Y coordinate to move to."],
    ["speed?", "The speed of the mouse movement. Optional."],
]);

registerCommand("drag", async (args, {res, err, script, vr, sendUsage}) => {
    const x = parseFloat(vr(args[0]));
    const y = parseFloat(vr(args[1]));
    if (isNaN(x) || isNaN(y)) return sendUsage();
    robot.dragMouse(x, y);
}, "Drags the mouse with mouse button held down.", [
    ["x", "The X coordinate to drag to."],
    ["y", "The Y coordinate to drag to."]
]);

registerCommand("scroll", async (args, {res, err, script, vr, sendUsage}) => {
    const x = parseFloat(vr(args[0]));
    const y = parseFloat(vr(args[1]));
    if (isNaN(x) || isNaN(y)) return sendUsage();
    robot.scrollMouse(x, y);
}, "Scrolls the mouse in any direction.", [
    ["x", "The X coordinate of the scroll."],
    ["y", "The Y coordinate of the scroll."]
]);

registerCommand("position", async (args, {res, err, script, vr, assign, sendUsage}) => {
    const vx = args[0];
    const vy = args[1];
    if (!vx || !vy) return sendUsage();
    const pos = robot.getMousePos();
    if (!assign(vx, pos.x + "", "string")) return err("Variable names cannot start with numbers.");
    if (!assign(vy, pos.y + "", "string")) return err("Variable names cannot start with numbers.");
}, "Gets the position of the mouse.", [
    ["variableX", "The variable that will be used for the X value of the mouse."],
    ["variableY", "The variable that will be used for the Y value of the mouse."]
]);

registerCommand("pixel", async (args, {res, err, script, vr, sendUsage}) => {
    const x = parseFloat(vr(args[0]));
    const y = parseFloat(vr(args[1]));
    if (isNaN(x) || isNaN(y)) return sendUsage();
    res(robot.getPixelColor(x, y));
}, "Scrolls the mouse in any direction.", [
    ["x", "The X coordinate of the scroll."],
    ["y", "The Y coordinate of the scroll."]
], "Color string, Example: #123456");

registerCommand(["screensize", "size"], async (args, {res, err, script, vr, assign, sendUsage}) => {
    const vw = args[0];
    const vh = args[1];
    if (!vw || !vh) return sendUsage();
    const pos = robot.getScreenSize();
    if (!assign(vw, pos.width + "", "string")) return err("Variable names cannot start with numbers.");
    if (!assign(vh, pos.height + "", "string")) return err("Variable names cannot start with numbers.");
}, "Gets the width and height of the screen.", [
    ["variableWidth", "The variable that will be used for the width of the screen."],
    ["variableHeight", "The variable that will be used for the height of the screen."]
]);

registerCommand(["mousedelay", "msdelay"], async (args, {res, err, script, vr, sendUsage}) => {
    const delay = parseFloat(vr(args[0]));
    if (isNaN(delay)) return sendUsage();
    robot.setMouseDelay(delay * 1000);
}, "Sets the typing delay of the mouse.", [
    ["delay", "The delay of typing to mouse in SECONDS."]
]);

registerCommand(["keyboarddelay", "kbdelay"], async (args, {res, err, script, vr, sendUsage}) => {
    const delay = parseFloat(vr(args[0]));
    if (isNaN(delay)) return sendUsage();
    robot.setKeyboardDelay(delay * 1000);
}, "Sets the typing delay of the keyboard.", [
    ["delay", "The delay of typing to keyboard in SECONDS."]
]);

const waitingPrompts = [];

registerCommand("readline", async (args, {res, err, script, vr, sendUsage}) => {
    Terminal.enableInput();

}, "Reads line from the terminal.", [],  "string");

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

// DONE CLICK           right/left/v1 double/single/v2
// DONE MOVE            x: float y: float speed?: float
// DONE DRAG            x: float y: float
// DONE SCROLL          x: float y: float
// DONE POSITION        v1 v2
// DONE PIXEL           x: float y: float
// DONE SCREENSIZE      v1 v2
// DONE MOUSEDELAY      seconds: float
// DONE KEYBOARDDELAY   seconds: float
// DONE TYPE            text: string cpm?: float
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
// TODO TIMEMS
// TODO TIMENANO
// DONE STOP

// TODO FILEWRITE       file: string content: string
// TODO FILEREAD        file: string content: string
// TODO EVALJS          text: string

// TODO PERM ADD        permission: string script: string
// TODO PERM RM         permission: string script: string
// TODO PERM LIST       script: string

// TODO FOREACH         v vInd vVal code: string
// TODO REPEAT          v from: number to: number code: string
// TODO ARGUMENTS
// TODO TORGBA          hex: string
// TODO TOHEX           r: number g: number b: number a: number

// TODO: SELENIUM JS?

let terminalVariables = {};

const _msg = () => {
    const m = [...terminalMessages];
    terminalMessages = [];
    return m;
};
const _prompt_ = async (str: string) => {
    Terminal.disableInput();
    await tickScript([str], "", terminalVariables);
};
const _stop_ = (n: string) => {
    if (!inputOn) Terminal.enableInput();
    if (n) scripts.delete(n);
    else scripts.clear();
    Terminal.scripts();
};

module.exports = {
    scripts_: scripts,
    msg: _msg,
    prompt_: _prompt_,
    stop_: _stop_
};