import { relative } from "node:path";
import { GithubPreview } from "./github-preview.ts";
import { onBeforeExit } from "./nvim/on-before-exit.ts";
import { onConfigUpdate } from "./nvim/on-config-update.ts";
import { onContentChange } from "./nvim/on-content-change.ts";
import { onCursorMove } from "./nvim/on-cursor-move.ts";
import { type CustomEvents, type WsServerMessage } from "./types.ts";

const app = await GithubPreview.start();

onConfigUpdate(app, async (update) => {
    await app.updateConfig(update);
    app.wsSend({ type: "update_config", config: app.config });
    return null;
});

await onBeforeExit(app, async () => {
    await app.goodbye();
    return null;
});

await onCursorMove(
    app,
    async ([buffer, path, cursor_line, cursor_col]: CustomEvents["notifications"]["cursor_move"]) => {
        const relativePath = relative(app.root, path);
        if (!path || (app.config.overrides.single_file && relativePath !== app.currentPath)) return;
        app.nvim.logger?.verbose({
            ON_CURSOR_MOVE: { buffer, path: relativePath, cursorLine: cursor_line, cursorCol: cursor_col },
        });

        const message: WsServerMessage = {
            type: "cursor_move",
            cursorLine: cursor_line,
            cursorCol: cursor_col,
            currentPath: relativePath,
        };

        if (app.currentPath !== relativePath) {
            message.lines = await app.nvim.call("nvim_buf_get_lines", [buffer, 0, -1, true]);
            app.lines = message.lines;
        }

        app.cursorLine = message.cursorLine;
        app.cursorCol = message.cursorCol;
        app.currentPath = message.currentPath;

        app.wsSend(message);
    },
);

await onContentChange(app, (lines, path) => {
    const relativePath = relative(app.root, path);
    if (!path || (app.config.overrides.single_file && relativePath !== app.currentPath)) return;
    app.nvim.logger?.verbose({ ON_CONTENT_CHANGE: { lines, path: relativePath } });

    const message: WsServerMessage = {
        type: "content_change",
        currentPath: relativePath,
        linesCountChange: app.lines.length !== lines.length,
        lines,
    };

    app.currentPath = message.currentPath;
    app.lines = message.lines;

    app.wsSend(message);
});
