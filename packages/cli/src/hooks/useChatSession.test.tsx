import { describe, expect, test } from "bun:test"
import { frame, renderTui, settle, untilSettled } from "../../test/harness.js"
import { ANSWER_FRAMES, scriptedTransport } from "../../test/scripted-transport.js"
import type { ChatTransport } from "../core/chat/transport.js"
import type { ChatMessage } from "../core/chat/types.js"
import type { ChatSession } from "./useChatSession.js"
import { sessionTitle, transcript, useChatSession } from "./useChatSession.js"

/** The probe is how a hook is called the way a component calls it: through a render, not directly. */
let chat: ChatSession | null = null

function Probe({ transport }: { transport: ChatTransport }) {
  chat = useChatSession(transport)
  return (
    <box flexDirection="column">
      {chat.messages.map((message) => (
        <text
          key={message.id}
        >{`${message.role} ${message.status} [${message.content}] [${message.reasoning}] ${message.error ?? ""}`}</text>
      ))}
      <text>{chat.generating ? "generating" : "settled"}</text>
    </box>
  )
}

function current(): ChatSession {
  if (chat === null) throw new Error("the probe never rendered")
  return chat
}

/** The model the caller passes, standing in for the live one `RootLayout` hands over. */
const SUBMITTED_MODEL = "claude-sonnet-4-5"

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return { id: "m1", role: "assistant", content: "", reasoning: "", status: "complete", error: null, ...overrides }
}

describe("useChatSession", () => {
  test("one submit puts the prompt and an empty streaming turn on screen in a single render", async () => {
    const scripted = scriptedTransport()
    const setup = await renderTui(<Probe transport={scripted.transport} />)

    expect(current().submit("hello there", SUBMITTED_MODEL)).toEqual({ accepted: true })
    await settle(setup)

    const screen = frame(setup)
    expect(screen).toContain("user complete [hello there] []")
    expect(screen).toContain("assistant streaming [] []")
    expect(screen).toContain("generating")
    // The transport has not been reached at all, so nothing on screen came from the server.
    expect(scripted.created).toHaveLength(0)
    expect(scripted.streamed).toHaveLength(0)
    setup.renderer.destroy()
  })

  test("text and reasoning deltas accumulate on the streaming turn", async () => {
    const scripted = scriptedTransport(ANSWER_FRAMES)
    const setup = await renderTui(<Probe transport={scripted.transport} />)

    current().submit("what is it", SUBMITTED_MODEL)
    scripted.release()
    await untilSettled(setup, () => frame(setup).includes("[the answer is 42]"))

    expect(frame(setup)).toContain("assistant complete [the answer is 42] [weighing it]")
    setup.renderer.destroy()
  })

  test("a clean end settles the turn as complete", async () => {
    const scripted = scriptedTransport([{ type: "text", text: "done" }, { type: "finish" }])
    const setup = await renderTui(<Probe transport={scripted.transport} />)

    current().submit("go", SUBMITTED_MODEL)
    scripted.release()
    await untilSettled(setup, () => frame(setup).includes("[done]"))

    expect(frame(setup)).toContain("assistant complete [done] []")
    expect(frame(setup)).toContain("settled")
    setup.renderer.destroy()
  })

  test("an error frame settles the turn as failed and keeps the frame's own message", async () => {
    const scripted = scriptedTransport([
      { type: "text", text: "half an " },
      { type: "error", code: "MODEL_FAILED", message: "The model failed to answer this turn" },
    ])
    const setup = await renderTui(<Probe transport={scripted.transport} />)

    current().submit("go", SUBMITTED_MODEL)
    scripted.release()
    await untilSettled(setup, () => frame(setup).includes("The model failed to answer this turn"))

    expect(frame(setup)).toContain("assistant failed [half an ] [] The model failed to answer this turn")
    setup.renderer.destroy()
  })

  test("a submit while a turn is live is refused, and the turn on screen is untouched", async () => {
    const scripted = scriptedTransport(ANSWER_FRAMES)
    const setup = await renderTui(<Probe transport={scripted.transport} />)

    expect(current().submit("first", SUBMITTED_MODEL)).toEqual({ accepted: true })
    expect(current().submit("second", SUBMITTED_MODEL)).toEqual({ accepted: false, reason: "A turn is already running" })
    await settle(setup)

    expect(frame(setup)).toContain("user complete [first] []")
    expect(frame(setup)).not.toContain("second")

    // The refused submit reached neither call on the transport, so the invariant is the network's too.
    scripted.release()
    await untilSettled(setup, () => frame(setup).includes("[the answer is 42]"))
    expect(scripted.created).toHaveLength(1)
    expect(scripted.streamed).toHaveLength(1)
    setup.renderer.destroy()
  })

  test("the session is created once, named after the prompt, and reused by the next turn", async () => {
    const scripted = scriptedTransport([{ type: "finish" }])
    const setup = await renderTui(<Probe transport={scripted.transport} />)

    current().submit("rename the readme button", SUBMITTED_MODEL)
    scripted.release()
    await untilSettled(setup, () => frame(setup).includes("assistant complete"))

    expect(scripted.created).toEqual([{ title: "rename the readme button", model: "claude-sonnet-4-5" }])
    expect(current().sessionId).toBe("session-scripted")

    scripted.release()
    expect(current().submit("and the docs", SUBMITTED_MODEL)).toEqual({ accepted: true })
    await untilSettled(setup, () => frame(setup).includes("and the docs"))

    expect(scripted.created).toHaveLength(1)
    expect(scripted.streamed.map((request) => request.sessionId)).toEqual(["session-scripted", "session-scripted"])
    setup.renderer.destroy()
  })

  test("the model the caller hands the submit is the model the session is created with", async () => {
    const scripted = scriptedTransport([{ type: "finish" }])
    const setup = await renderTui(<Probe transport={scripted.transport} />)

    current().submit("switch me to opus", "claude-opus-4-5")
    scripted.release()
    await untilSettled(setup, () => frame(setup).includes("assistant complete"))

    expect(scripted.created).toEqual([{ title: "switch me to opus", model: "claude-opus-4-5" }])
    setup.renderer.destroy()
  })

  test("the transcript carries the settled turns and the prompt, and never the turn still being written", async () => {
    const scripted = scriptedTransport(ANSWER_FRAMES)
    const setup = await renderTui(<Probe transport={scripted.transport} />)

    current().submit("what is it", SUBMITTED_MODEL)
    scripted.release()
    await untilSettled(setup, () => frame(setup).includes("[the answer is 42]"))

    current().submit("and now?", SUBMITTED_MODEL)
    await untilSettled(setup, () => scripted.streamed.length === 2)

    expect(scripted.streamed[1]).toEqual({
      sessionId: "session-scripted",
      messages: [
        { role: "user", content: "what is it" },
        { role: "assistant", content: "the answer is 42" },
        { role: "user", content: "and now?" },
      ],
    })
    setup.renderer.destroy()
  })

  test("an abort mid-stream settles the turn as interrupted and keeps exactly the text that arrived", async () => {
    const scripted = scriptedTransport([{ type: "reasoning", text: "weighing " }, { type: "text", text: "half an " }, { type: "finish" }], {
      parkAfterFrames: 2,
    })
    const setup = await renderTui(<Probe transport={scripted.transport} />)

    current().submit("stop me partway", SUBMITTED_MODEL)
    scripted.release()
    await untilSettled(setup, () => frame(setup).includes("[half an ]"))

    current().abort()
    await untilSettled(setup, () => frame(setup).includes("assistant interrupted"))

    // What arrived is what the user saw, so it stays. Only the unreached tail of the reply is gone,
    // which is why the status rather than the content is what marks the turn.
    expect(frame(setup)).toContain("assistant interrupted [half an ] [weighing ]")
    expect(frame(setup)).toContain("settled")
    expect(current().submit("and now", SUBMITTED_MODEL)).toEqual({ accepted: true })
    setup.renderer.destroy()
  })

  test("reset empties the conversation and forgets the session", async () => {
    const scripted = scriptedTransport([{ type: "finish" }])
    const setup = await renderTui(<Probe transport={scripted.transport} />)

    current().submit("something", SUBMITTED_MODEL)
    scripted.release()
    await untilSettled(setup, () => frame(setup).includes("assistant complete"))

    current().reset()
    await settle(setup)

    expect(current().messages).toEqual([])
    expect(current().sessionId).toBeNull()
    expect(frame(setup)).not.toContain("something")
    setup.renderer.destroy()
  })

  test("reset during a live turn stops it, and its late session id never comes back", async () => {
    const scripted = scriptedTransport(ANSWER_FRAMES)
    const setup = await renderTui(<Probe transport={scripted.transport} />)

    expect(current().submit("first", SUBMITTED_MODEL)).toEqual({ accepted: true })

    // The turn is parked inside the transport, so `/clear` lands while the session is still being made.
    current().reset()
    await settle(setup)

    expect(current().messages).toEqual([])
    expect(current().sessionId).toBeNull()

    scripted.release()
    await settle(setup)
    await settle(setup)

    // The aborted run finished after the clear, and the id it learned did not write itself back in.
    expect(current().sessionId).toBeNull()
    expect(current().messages).toEqual([])
    expect(frame(setup)).not.toContain("first")
    expect(frame(setup)).not.toContain("the answer is 42")
    setup.renderer.destroy()
  })
})

describe("transcript", () => {
  test("drops the in-flight turn and keeps every settled one, ending on the user", () => {
    const messages: ChatMessage[] = [
      message({ id: "a", role: "user", content: "first question" }),
      message({ id: "b", role: "assistant", content: "the first answer" }),
      message({ id: "c", role: "user", content: "second question" }),
      message({ id: "d", role: "assistant", content: "", reasoning: "half a thought", status: "streaming" }),
    ]

    expect(transcript(messages)).toEqual([
      { role: "user", content: "first question" },
      { role: "assistant", content: "the first answer" },
      { role: "user", content: "second question" },
    ])
  })

  test("keeps an interrupted answer, because it is a turn that ended rather than one that never began", () => {
    const messages: ChatMessage[] = [message({ id: "a", role: "assistant", content: "half an answer", status: "interrupted" })]

    expect(transcript(messages)).toEqual([{ role: "assistant", content: "half an answer" }])
  })
})

describe("sessionTitle", () => {
  test("names the session after the prompt", () => {
    expect(sessionTitle("  rename the readme button  ")).toBe("rename the readme button")
  })

  test("caps the title at the length the create-session route accepts", () => {
    expect(sessionTitle("x".repeat(300))).toBe("x".repeat(200))
  })

  test("falls back when the prompt is blank", () => {
    expect(sessionTitle("   ")).toBe("Untitled session")
  })
})
