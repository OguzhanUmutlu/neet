// noinspection JSUnusedLocalSymbols

const fs = require("fs");
const robot = require("robotjs");
const chalk = require("chalk");

const modifiers = [
    "backspace", "delete", "enter", "tab", "escape", "up", "down", "right", "left", "home", "end", "pageup", "pagedown", "f1", "f2", "f3", "f4",
    "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12", "command", "alt", "control", "shift", "right_shift", "space", "printscreen", "insert",
    "audio_mute", "audio_vol_down", "audio_vol_up", "audio_play", "audio_stop", "audio_pause", "audio_prev", "audio_next", "audio_rewind",
    "audio_forward", "audio_repeat", "audio_random", "numpad_0", "numpad_1", "numpad_2", "numpad_3", "numpad_4", "numpad_5", "numpad_6",
    "numpad_7", "numpad_8", "numpad_9", "lights_mon_up", "lights_mon_down", "lights_kbd_toggle", "lights_kbd_up", "lights_kbd_down"
];

type TypeVariable<T, V> = { type: T, value: V };
type TypeStringVariable = TypeVariable<"string", string>;
type TypeListVariable = TypeVariable<"list", string[]>;
type TypeObjectVariable = TypeVariable<"object", Record<string, string>>;
type TypeAnyVariable = TypeStringVariable | TypeListVariable | TypeObjectVariable;

type TypeScript = {
    name: string,
    file: string,
    code: string,
    index: number,
    variables: Record<string, TypeAnyVariable>,
    onEnd: () => void,
    returned: string,
    settings: {
        cpm: number | null
    }
};
type TypeCommandHandler = (args: string[], options: {
    print: (text: string, color?: string | undefined, backgroundColor?: string | undefined, pseudo?: boolean) => void,
    res: (text: string, color?: string | undefined, backgroundColor?: string | undefined, pseudo?: boolean) => void,
    err: (text: string, color?: string | undefined, backgroundColor?: string | undefined, pseudo?: boolean) => void,
    setIndex: (index: number) => void,
    clear: () => void,
    currentIndex: () => number,
    lines: string[],
    variables: Record<string, TypeAnyVariable>,
    sendUsage: () => void,
    script: TypeScript | null,
    commandName: string,
    assign: (name: string, value: string | string[] | Record<string, string>, type: "string" | "list" | "object") => string | void,
    assignGlobal: (name: string, value: string | string[] | Record<string, string>, type: "string" | "list" | "object") => string | void,
    vr: (text: string) => string,
    isPseudo: boolean
}) => void;

type TypeCommand = {
    names: string[],
    handler: TypeCommandHandler,
    description: string,
    usage: [string, string][],
    returns: string,
    usageTop: string | undefined
};

const scriptPermissions = {};
const runningScripts: TypeScript[] = [];
const commands: TypeCommand[] = [];
const registerCommand = (name: string | string[], handler: TypeCommandHandler, description: string, usage: [string, string][] = [], returns: string = "", usageTop?: string) => {
    if (!Array.isArray(name)) name = [name];
    name = name.map(i => i.toLowerCase());
    const existing = commands.map(i => i.names).flat().find(i => name.includes(i));
    if (existing) throw new Error("Existing command: " + existing);
    commands.push({
        names: name,
        handler,
        description,
        usage,
        returns,
        usageTop
    });
};
const findCommand = (name: string) => commands.find(i => i.names.includes(name.toLowerCase()));
const eventLoop = async (): Promise<any> => {
    while (runningScripts.length) for (let i = 0; i < runningScripts.length; i++) {
        const k = runningScripts[i];
        await tickScript(k.code.split("\n"), k.name, k.variables);
    }
    setTimeout(eventLoop);
};
eventLoop().then(r => r);
const globalVar = (str: string, vars: Record<string, TypeAnyVariable>): string => {
    str = str || "";
    return str
        .replaceAll(/[^$]?\$\$n/g, "\n")
        .replaceAll(/[^$]?\$\$s/g, " ")
        .replaceAll(/[^$]?\$_PI/g, Math.PI.toString())
        .replaceAll(/[^$]?\$_E/g, Math.E.toString())
        .replaceAll(/[^$]?\$\D[a-zA-Z\d]*/g, (match: string) => {
            const s = match.trim().substring(1);
            const v = vars[s];
            if (v && v.type === "string") return v.value;
            return match;
        })
        .replaceAll(/[^$]?\$_/g, "")
        .replaceAll("$$", "$");
};
const parseUsage = (usage: [string, string][], usageTop: string | undefined) => (usageTop || usage.map(i => `[${i[0]}]`).join(" ")) + "\n" + usage.map(i => `  ${i[0]} - ${i[1]}`).join("\n");
const logText = (str: string, color?: string, backgroundColor?: string): void => {
    let ch: any = chalk;
    if (color) ch = ch.hex(color);
    if (backgroundColor) ch = ch.bgHex(backgroundColor);
    process.stdout.write(ch(str));
};
const ERR_COLOR = "#ff0000";
const tickScript = async (lines: string[], name: string = "", variables: Record<string, TypeAnyVariable> = {}, pseudo = false, log = true): Promise<string | null> => {
    const script = name ? runningScripts.find(i => i.name === name) || null : null;
    const increaseIndex = () => {
        if (pseudo) return null;
        if (!script) return null;
        if (script.index === lines.length - 1) {
            script.onEnd();
        } else script.index++;
        return script.returned;
    };
    const line = (script && !pseudo ? lines[script.index] : lines[0]).trimStart().replace("\r", "");
    if (!line || line[0] === "#" || line[0] + line[1] === "//") return increaseIndex();
    const arg = line.split(" ");
    const cmd = findCommand(arg[0]);
    let indexUpdated = false;
    let hasError = false;
    let result: string[] = [];
    const prefix = script ? name + "#" + (script.index + 1) + " > " : "";
    if (cmd) {
        await cmd.handler(arg.slice(1), {
            print: (r, c, bg, pseudo2) => {
                if (log && !pseudo2) logText(r, c, bg);
                if (result.length) result[result.length - 1] += r;
                else result.push(r);
            },
            res: (r, c, bg, pseudo2) => {
                if (log && !pseudo2) logText(prefix + r + "\n", c, bg);
                result.push(r);
            },
            err: (r, c = ERR_COLOR, bg, pseudo2) => {
                logText(prefix + r + "\n", c, bg);
                hasError = true;
                if (script) script.returned = "";
            },
            setIndex: r => {
                if (!script) return;
                script.index = r;
                indexUpdated = true;
            },
            clear: () => console.clear(),
            currentIndex: () => script ? script.index : 0,
            lines,
            variables,
            sendUsage: () => {
                logText(prefix + "Invalid usage!\n\n" + cmd.names[0] + " " + parseUsage(cmd.usage, cmd.usageTop) + "\n", "#ff0000");
                hasError = true;
            },
            script,
            commandName: arg[0],
            assign: (name: string, value: any, type: any): string | void => {
                if (!isNaN(parseInt(name[0]))) return "Variable names cannot start with numbers.";
                if (variables[name] && variables[name].type !== type) return "Variable already exists with a different type.";
                variables[name] = {type, value};
            },
            assignGlobal: (name: string, value: any, type: any): string | void => {
                if (!isNaN(parseInt(name[0]))) return "Variable names cannot start with numbers.";
                if (globalVariables[name] && globalVariables[name].type !== type) return "Variable already exists with a different type.";
                globalVariables[name] = {type, value};
            },
            vr: str => globalVar(str, {...globalVariables, ...variables}),
            isPseudo: pseudo
        });
    } else {
        logText(prefix + "'" + arg[0] + "' is not recognized as an internal command. Try using command 'help'\n", ERR_COLOR);
        hasError = true
    }
    if (hasError && script) {
        script.onEnd();
        return null;
    }
    if (!indexUpdated) increaseIndex();
    return result.join("\n");
};

registerCommand(["help", "?"], (args, {res, err}) => {
    const target = args[0];
    if (target) {
        const cmd = findCommand(target);
        if (!cmd) return err("This command is not supported by the help utility.");
        res(
            "Command: " + cmd.names[0] +
            (cmd.names.length > 1 ? "\nAliases: " + cmd.names.slice(1).join(", ") : "") +
            "\nDescription: " + cmd.description +
            "\nUsage: " + cmd.names[0] + " " + parseUsage(cmd.usage, cmd.usageTop) +
            "\nReturns: " + (cmd.returns ? cmd.returns : "nothing")
        );
    } else {
        res("For more information on a specific command, type 'help command-name'\n");
        const longest = commands.map(i => i.names[0].length).sort((a, b) => b - a)[0];
        commands.forEach(i => res(i.names[0] + " ".repeat(longest - i.names[0].length + 3) + i.description));
    }
}, "Provides help information for Neet commands.", [
    ["command", "The name of the command"]
]);

let _id_ = 0;
registerCommand("run", async (args, {err, res, print, script}) => {
    let file = args.join(" ");
    if (file === script?.file) return err("A script file cannot run itself.");
    if (!file.endsWith(".neet") && !fs.existsSync(file)) file += ".neet";
    if (!fs.existsSync(file)) return err("The script file doesn't exist.");
    if (!fs.statSync(file).isFile()) return err("The script should be a file.");
    let _pr: Function;
    const prom = new Promise(r => _pr = r);
    const scr = {
        name: file + (++_id_),
        file,
        code: fs.readFileSync(file, "utf8"),
        index: 0,
        variables: {},
        settings: {
            cpm: null
        },
        returned: "",
        onEnd: () => {
            _pr();
            runningScripts.splice(runningScripts.indexOf(scr), 1);
        }
    };
    runningScripts.push(scr);
    await prom;
    res(scr.returned);
}, "Runs script file(s).", [
    ["script", "The name of the script"]
]);

registerCommand(["return", "ret"], (args, {script, err, vr}) => {
    if (!script) return err("Returning value is only allowed in scripts.");
    if (script.returned) return err("The script has already returned something!");
    script.returned = vr(args[0]);
}, "Returns a value.", [
    ["result", "A result."]
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

registerCommand("skip", (args, {err, sendUsage, setIndex, currentIndex, vr, script}) => {
    const add = parseInt(vr(args[0]));
    if (!script) return err("Altering line index is only allowed in scripts.");
    const current = currentIndex();
    const target = current + add;
    if (isNaN(target) || target < 0) return sendUsage();
    if (add === 0) return err("You cannot go to the same line!");
    setIndex(target);
}, "Skips the given amount of lines in the script.", [
    ["amount", "The amount of lines to script"]
]);

registerCommand("visit", async (args, {err, sendUsage, currentIndex, lines, variables, vr, script}) => {
    const index = parseInt(vr(args[0]));
    if (!script) return err("Running line is only allowed in scripts.");
    if (isNaN(index) || index !== Math.floor(index) || index < 1) return sendUsage();
    if (index === currentIndex()) return err("You cannot visit the same line!");
    await tickScript(lines, script.name, variables, true);
}, "Runs a line in the script immediately.", [
    ["line", "The target line"]
]);

registerCommand("print", async (args, {res, vr, variables}) => {
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

registerCommand("if", async (args, {res, err, sendUsage, vr, variables, script}) => {
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
        if (code) await tickScript([code], script?.name || "", variables, true);
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

registerCommand(["var", "let"], async (args, {err, sendUsage, vr, variables, assign}) => {
    const name = vr(args[0]);
    const value = vr(args.slice(1).join(" "));
    if (!name || !value) return sendUsage();
    let r;
    if ((r = assign(name, value, "string"))) return err(r);
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


registerCommand(["glob", "global"], async (args, {err, sendUsage, vr, assignGlobal}) => {
    const name = vr(args[0]);
    const value = vr(args.slice(1).join(" "));
    if (!name || !value) return sendUsage();
    if (!assignGlobal(name, value, "string")) return err("Variable names cannot start with numbers.");
}, "Sets a global variable's value.", [
    ["name", "Variable name"],
    ["value", "Value of the variable"]
]);

registerCommand(["deleteglob", "delglob", "rmglob", "removeglob", "deleteglobal", "delglobal", "rmglobal", "removeglobal"], async (args, {
    err,
    sendUsage,
    variables,
    vr
}) => {
    const name = vr(args[0]);
    if (!name) return sendUsage();
    if (!isNaN(parseInt(name[0]))) return err("Variable names cannot start with numbers.");
    delete globalVariables[name];
}, "Deletes a global variable.", [
    ["name", "Variable name"]
]);

registerCommand(["isnumeric", "isnum"], async (args, {res, sendUsage, vr}) => {
    const num = parseInt(vr(args[0]));
    res(isNaN(num) ? "0" : "1");
}, "Checks if something is numeric.", [
    ["text", "A text"]
], "If is a number 1, unless 0");

registerCommand(["operation", "opr"], async (args, {res, err, sendUsage, vr}) => {
    const actions = [];
    if (args.length % 2 === 0) return sendUsage();
    for (let i = 0; i < args.length; i++) {
        let a: string;
        if (i % 2 === 0) {
            a = vr(args[i]);
            if (isNaN(parseFloat(a))) return sendUsage();
        } else {
            a = args[i];
            if (!["+", "-", "*", "/", "**", ">>", "<<", "%", "^"].includes(a)) return sendUsage();
        }
        actions.push(a);
    }
    res(eval(actions.join(" ")));
}, "Does mathematical operations on numbers.", [
    ["number", "A number."],
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
`]
], "number", "[number] [operator] [number] [operator] [number]...");

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

registerCommand(["assign", "asg"], async (args, {res, err, sendUsage, variables, vr, assign, script}) => {
    const variable = vr(args[0]);
    const code = args.slice(1).join(" ");
    if (!variable || !code) return sendUsage();
    const r = await tickScript([code], script?.name, variables, true, false);
    if (r) {
        const k = assign(variable, r, "string");
        if (k) err(k);
    }
}, "Assigns the variable a result of a code.", [
    ["variable", "The variable's name."],
    ["code", "The code."]
]);

registerCommand(["stop", "exit"], async (args, {res, err, script}) => {
    if (!script) return err("Exiting is only allowed in scripts.");
    err("Commanded stop action.");
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
    ["speed?", "The speed of the mouse movement. OPTIONAL."],
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
    let r: string | void;
    if ((r = assign(vx, pos.x + "", "string"))) return err(r);
    if ((r = assign(vy, pos.y + "", "string"))) return err(r);
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
    let r: string | void;
    if ((r = assign(vw, pos.width + "", "string"))) return err(r);
    if ((r = assign(vh, pos.height + "", "string"))) return err(r);
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

const stdin = process.stdin;

registerCommand("readline", async (args, {res, err, script, vr, sendUsage}) => {
    module.exports.reading = true;
    stdin.setRawMode(false);
    stdin.resume();
    let _pr: Function;
    stdin.once("data", (buffer: Buffer) => _pr(buffer.toString().replace("\r", "").replace("\n", "")));
    const rs: string = await new Promise(r => _pr = r);
    stdin.pause();
    module.exports.reading = false;
    res(rs);
}, "Reads line from the terminal.", [], "string");

registerCommand("readkey", async (args, {res, err, script, vr, sendUsage}) => {
    module.exports.reading = true;
    stdin.setRawMode(true);
    stdin.resume();
    let _pr: Function;
    stdin.once("data", (buffer: Buffer) => _pr(buffer.toString().replace("\r", "").replace("\n", "")));
    const rs: string = await new Promise(r => _pr = r);
    stdin.setRawMode(false);
    stdin.pause();
    module.exports.reading = false;
    res(rs);
}, "Reads a key from the terminal.", [], "string");

const terminalOptions = {
    cpm: null
};

registerCommand(["typecpm"], async (args, {res, err, script, vr, sendUsage}) => {
    const cpm = parseFloat(vr(args[0]));
    const settingTo = script ? script.settings : terminalOptions;
    if (isNaN(cpm) || cpm <= 0) return settingTo.cpm = null;
    settingTo.cpm = cpm;
}, "Sets the type speed.", [
    ["cpm", "Sets the characters per minute."]
]);

registerCommand(["type", "typetext"], async (args, {res, err, script, vr, sendUsage}) => {
    const text = vr(args.join(" "));
    if (!text) return sendUsage();
    const cpm = script ? script.settings.cpm : terminalOptions.cpm;
    if (!cpm) robot.typeString(text);
    else robot.typeStringDelayed(text, cpm);
}, "Types a text in the keyboard.", [
    ["text", "The text to type in keyboard."]
]);

registerCommand("keytap", async (args, {res, err, script, vr, sendUsage}) => {
    const key = vr(args[0]);
    if (!key || (key.length > 1 && !modifiers.includes(key))) return sendUsage();
    robot.keyTap(key);
}, "Taps to a key in the keyboard.", [
    ["key", "The key to press in the keyboard."]
]);

registerCommand("keydown", async (args, {res, err, script, vr, sendUsage}) => {
    const key = vr(args[0]);
    if (!key || (key.length > 1 && !modifiers.includes(key))) return sendUsage();
    robot.keyToggle(key, "down");
}, "Presses a key down in the keyboard.", [
    ["key", "The key to press down in the keyboard."]
]);

registerCommand("keyup", async (args, {res, err, script, vr, sendUsage}) => {
    const key = vr(args[0]);
    if (!key || (key.length > 1 && !modifiers.includes(key))) return sendUsage();
    robot.keyToggle(key, "up");
}, "Releases a key in the keyboard.", [
    ["key", "The key to release up in the keyboard."]
]);

registerCommand("mousedown", async (args, {res, err, script, vr, sendUsage}) => {
    const button = vr(args[0]) || "left";
    if (!["left", "right", "middle"].includes(button)) return sendUsage();
    robot.mouseToggle("down", button);
}, "Presses a mouse button down in the mouse.", [
    ["key", "The button to press down in the mouse."]
]);

registerCommand("mouseup", async (args, {res, err, script, vr, sendUsage}) => {
    const button = vr(args[0]) || "left";
    if (!["left", "right", "middle"].includes(button)) return sendUsage();
    robot.mouseToggle("up", button);
}, "Presses a mouse button up in the mouse.", [
    ["key", "The button to press up in the mouse."]
]);

registerCommand(["vartype", "variableType"], async (args, {res, err, script, vr, variables, sendUsage}) => {
    const name = vr(args[0]);
    if (!name) return sendUsage();
    const variable = variables[name] || globalVariables[name];
    if (!variable) return res("undefined");
    res(variable.type);
}, "Returns the type of the variable.", [
    ["name", "The name of the variable to check."]
], "'string' or 'list' or 'object' or if it doesn't exist 'undefined'");

registerCommand("listcreate", async (args, {res, err, script, vr, variables, sendUsage, assign}) => {
    const name = vr(args[0]);
    if (!name) return sendUsage();
    let r;
    if ((r = assign(name, [], "list"))) return err(r);
}, "Creates a list variable.", [
    ["name", "The name of the list variable."]
]);

// DONE $$n(new line)
// DONE $$s(space)
// DONE $#PI
// DONE $#E
// DONE CLEAR
// DONE PRINT           text: string
// DONE RUN             ...scripts: string
// DONE GOTO            line: number
// DONE SKIP            amount: number
// DONE VISIT           line: number
// DONE IF              v1 comparator: ==,!=,>,<,>=,<= v2 code
// DONE ISNUMERIC       text: string
// DONE VAR             v value: string
// DONE GLOBAL          v value: string
// DONE DELETEVAR       name: string
// DONE OPERATION       n1: number operator: +,-,*,/,**,>>,<<,%,^ n1: number
// DONE MATH            abs/floor/ceil/sqrt... n: number
// DONE RANDOM          n1: number n2: number
// DONE RANDOMF         n1: float n2: float
// DONE READLINE
// DONE READKEY
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
// DONE TYPECPM         cpm?: float
// DONE TYPE            text: string
// DONE KEYTAP          key: string
// DONE KEYDOWN         key: string
// DONE KEYUP           key: string
// DONE MOUSEDOWN       button: string
// DONE MOUSEUP         button: string

// TODO ISKEYDOWN       key: string
// TODO HASPRESSED      key: string
// TODO ISMOUSEDOWN     button: string
// TODO ISCLICKED       button: string
// TODO HOTKEY          ...keys: string

// DONE WAIT            seconds: float
// DONE VARTYPE         name: string          RETURNS "string" | "list" | "object" | "undefined"

// DONE LISTCREATE     v
// TODO LISTADD        v value: string
// TODO LISTSET        v index: number value: string
// TODO LISTREMOVE     v index: number
// TODO LISTGET        v index: number
// TODO LISTINDEXOF    v value: string
// TODO LISTHAS        v index: number
// TODO LISTLENGTH     v
// TODO LISTSLICE      v vAssign index1: number index2: number

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

const globalVariables: Record<string, TypeAnyVariable> = {};
module.exports = {
    reading: false,
    prompt: async (str: string) => await tickScript([str], "", globalVariables)
};