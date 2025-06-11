import { useContext, useEffect, useState } from "react";
import { websocketContext } from "../websocket-provider/context.ts";
import { scroll, type Offsets } from "./scroll.ts";

export const CURSOR_LINE_ELEMENT_ID = "cursor-line-element-id";

type Props = {
    offsets: Offsets;
    cursorLineElement: HTMLElement | undefined;
    markdownContainerElement: HTMLElement | undefined;
};

export const CursorLine = ({ offsets, cursorLineElement, markdownContainerElement }: Props) => {
    const { config, registerHandler, refObject } = useContext(websocketContext);
    const [cursorLine, setCursorLine] = useState<number | null>(null);

    useEffect(() => {
        registerHandler("cursor-line", (message) => {
            if ("cursorLine" in message) {
                setCursorLine(message.cursorLine);
                // New cursor position from Neovim, so allow auto-scroll again
                if (refObject.current) {
                    refObject.current.userInterruptedScroll = false;
                }
            }
        });
    }, [registerHandler, refObject]);

    const overrides = config?.overrides;
    const lineColor = !overrides?.cursor_line.disable && overrides?.cursor_line.color;
    const topOffsetPct = overrides?.scroll.disable ? null : overrides?.scroll.top_offset_pct;

    useEffect(() => {
        if (!markdownContainerElement) return;

        const handleManualScroll = () => {
            if (refObject.current && !refObject.current.isAutoScrolling) {
                refObject.current.userInterruptedScroll = true;
                console.log(
                    "handleManualScroll: User scroll detected (not auto-scrolling), userInterruptedScroll set to true.",
                );
            } else if (refObject.current && refObject.current.isAutoScrolling) {
                console.log(
                    "handleManualScroll: Scroll event during auto-scroll (by animation). userInterruptedScroll not changed.",
                );
            }
        };

        markdownContainerElement.addEventListener("scroll", handleManualScroll, { passive: true });

        return () => {
            markdownContainerElement.removeEventListener("scroll", handleManualScroll);
        };
    }, [markdownContainerElement, refObject]);

    useEffect(() => {
        if (!cursorLineElement || !markdownContainerElement) return;

        if (refObject.current.skipScroll) {
            refObject.current.skipScroll = false;
        } else {
            // Only scroll if not interrupted by user
            if (!refObject.current.userInterruptedScroll) {
                scroll(
                    markdownContainerElement,
                    topOffsetPct,
                    offsets,
                    cursorLine,
                    cursorLineElement,
                    refObject,
                );
            }
        }
    }, [markdownContainerElement, cursorLineElement, topOffsetPct, cursorLine, refObject, offsets]);

    return (
        <div
            id={CURSOR_LINE_ELEMENT_ID}
            className="pointer-events-none absolute z-10 h-[36px] w-full"
            style={{
                // eslint-disable-next-line
                background: lineColor ? lineColor : "transparent",
                opacity: overrides?.cursor_line.opacity ?? 0,
            }}
        />
    );
};
