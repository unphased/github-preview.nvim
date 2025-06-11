import { type MutableRefObject } from "react";
import { type RefObject } from "../websocket-provider/context";

let currentAnimationId: number | null = null;
const SMOOTHING_FACTOR = 0.05; // Adjust for desired smoothness/speed (e.g., 0.1 for slower, 0.3 for faster)

function animateScroll(element: HTMLElement, targetY: number) {
    if (currentAnimationId !== null) {
        cancelAnimationFrame(currentAnimationId);
    }

    const step = () => {
        const currentY = element.scrollTop;
        const diff = targetY - currentY;

        // Stop if very close to target or if target is effectively reached
        if (Math.abs(diff) < 0.5) {
            element.scrollTop = targetY;
            currentAnimationId = null;
        } else {
            element.scrollTop += diff * SMOOTHING_FACTOR;
            currentAnimationId = requestAnimationFrame(step);
        }
    };

    currentAnimationId = requestAnimationFrame(step);
}

type Attrs = {
    offsetTop: number;
    scrollHeight: number;
    clientHeight: number;
    elemStartLine: number;
    elemEndLine: number;
};

function getAttrs(markdownContainerElement: HTMLElement, element: HTMLElement): Attrs {
    const { offsetTop, scrollHeight, clientHeight } = element;
    const startLineAttr = element.getAttribute("line-start");
    const endLineAttr = element.getAttribute("line-end");

    if (!startLineAttr || !endLineAttr) throw Error("sourceMap info missing");

    const attrs: Attrs = {
        offsetTop,
        scrollHeight,
        clientHeight,
        elemStartLine: Number(startLineAttr),
        elemEndLine: Number(endLineAttr),
    };

    let offsetParent = element.offsetParent as HTMLElement | null;

    while (offsetParent !== null && offsetParent.id !== markdownContainerElement.id) {
        // offsetTop is relative to some parent,
        // we want to recursively add offsetsTop all the way up to the markdownContainerElement
        attrs.offsetTop += offsetParent.offsetTop;
        offsetParent = offsetParent.offsetParent as HTMLElement | null;
    }

    return attrs;
}

export type Offsets = [number, HTMLElement][];

export function getScrollOffsets(
    markdownContainerElement: HTMLElement,
    markdownElement: HTMLElement,
): Offsets {
    // Elements must be sorted or footnote sourcemaps mess up with offsets.
    const sortedElements = Array.from(document.querySelectorAll("[line-start]")).sort(
        (a, b) => Number(a.getAttribute("line-start")) - Number(b.getAttribute("line-start")),
    ) as HTMLElement[];

    // HTMLElement kept arround for debugging purposes
    const sourceLineOffsets: Offsets = [];

    let currLine = 0;

    const isCodeFile =
        sortedElements.length === 1 &&
        sortedElements[0]?.tagName === "PRE" &&
        sortedElements[0].firstElementChild?.tagName === "CODE";

    for (let index = 0, len = sortedElements.length; index < len; index++) {
        const element = sortedElements[index]!;

        // If the element is not visible, we skip it because element.offsetTop is 0 for
        // non-visible elements and that messes up with scrollOffsets.
        // This usually happens with children of <details> tags
        if (!element.checkVisibility()) {
            continue;
        }

        const { elemStartLine, elemEndLine, offsetTop, scrollHeight } = getAttrs(
            markdownContainerElement,
            element,
        );

        if (currLine >= elemStartLine) {
            currLine = elemStartLine;
        } else {
            let acc = markdownElement.offsetTop + markdownElement.getBoundingClientRect().top;
            let perLine = 0;

            const prevElement = sortedElements[index - 1];
            if (prevElement) {
                const prevAttrs = getAttrs(markdownContainerElement, prevElement);
                const prevEleBottom = prevAttrs.offsetTop + prevAttrs.clientHeight;
                const offsetToInterpolate = offsetTop - prevEleBottom;
                perLine = offsetToInterpolate / (elemStartLine - currLine);
                acc = prevEleBottom;
            }

            while (currLine < elemStartLine) {
                sourceLineOffsets[currLine] = [acc, element];

                if (!acc && sourceLineOffsets[currLine - 1]?.[0]) {
                    // In some cases acc is 0 here
                    // it happens inside of <details>, maybe there are other cases.
                    // If there's a prev offset already, we copy the value over
                    sourceLineOffsets[currLine]![0] = sourceLineOffsets[currLine - 1]![0];
                }

                currLine++;
                acc += perLine;
            }
        }

        let acc = offsetTop;
        // +1, because we go up until <= elemEndLine
        let lineRange = elemEndLine + 1 - elemStartLine;

        if (isCodeFile) {
            // -1, because when rendering only code, we omit
            // the fence closing line ```
            // or at least that's what I think is happening
            lineRange -= 1;
        }

        const isFencedCodeInMarkdown =
            !isCodeFile &&
            element.tagName === "PRE" &&
            element.firstElementChild?.tagName === "CODE";

        const perLine = scrollHeight / lineRange;

        while (currLine <= elemEndLine) {
            sourceLineOffsets[currLine] = [acc, element];

            if (currLine !== elemStartLine && isFencedCodeInMarkdown) {
                // move offsets up a little bit when in fenced code
                // in markdown files to center cursorline
                sourceLineOffsets[currLine]![0] -= 8;
            }

            currLine++;
            acc += perLine;
        }
    }

    return sourceLineOffsets;
}

export function scroll(
    markdownContainerElement: HTMLElement,
    topOffsetPct: number | null | undefined,
    offsets: Offsets,
    cursorLine: number | null,
    cursorLineElement: HTMLElement,
    refObject: MutableRefObject<RefObject>,
) {
    if (!offsets.length) {
        // without offsets we can't scroll
        return;
    }

    cursorLineElement.style.setProperty("display", cursorLine === null ? "none" : "block");

    if (refObject.current.hash.value) {
        // "consume" hash
        window.location.hash = refObject.current.hash.value;
        refObject.current.hash.value = undefined;
    }

    let scrollToLine: number | null = cursorLine;

    if (scrollToLine === null) {
        if (!window.location.hash) {
            if (currentAnimationId !== null) {
                cancelAnimationFrame(currentAnimationId);
                currentAnimationId = null;
            }
            markdownContainerElement.scrollTo({ top: 0, behavior: "instant" });
            return;
        }

        if (refObject.current.hash.lineStart) {
            // if the hash is a line range, we update the scroll target
            scrollToLine = refObject.current.hash.lineStart;
        } else {
            // if not, we exit scroll function and let browser handle
            // anchor navigation (to headings and stuff)
            return;
        }
    }

    let cursorLineOffset = offsets[scrollToLine];

    while (!cursorLineOffset) {
        // When adding new lines at the end of the buffer, the offset for the
        // new lines is not available until cursorHold
        cursorLineOffset = offsets[--scrollToLine];
    }

    cursorLineElement.style.setProperty("top", `${cursorLineOffset[0]}px`);

    if (typeof topOffsetPct !== "number") {
        // this means the user disabled synced scroll
        return;
    }

    const percent = topOffsetPct / 100;
    const targetScrollY =
        cursorLineOffset[0] +
        markdownContainerElement.offsetTop -
        window.screen.height * percent;

    animateScroll(markdownContainerElement, targetScrollY);
}
