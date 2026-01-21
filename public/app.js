const form = document.querySelector("#generator-form");
const urlInput = document.querySelector("#youtube-url");
const stylePresetInput = document.querySelector("#style-preset");
const styleDetailInput = document.querySelector("#style-detail");
const lengthInput = document.querySelector("#length");
const languageInput = document.querySelector("#language");
const statusEl = document.querySelector("#status");
const transcriptEl = document.querySelector("#transcript");
const articleEl = document.querySelector("#article");
const modeEl = document.querySelector("#mode");
const truncationNote = document.querySelector("#truncation-note");
const submitBtn = document.querySelector("#submit-btn");
const copyButtons = document.querySelectorAll("[data-copy-target]");

const defaultStatus =
  "Paste a YouTube URL and click Generate to see results.";

setStatus(defaultStatus);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();

  if (!url) {
    setStatus("Please provide a YouTube URL.", true);
    return;
  }

  setLoading(true);
  setStatus("Fetching transcript and generating article...");
  clearOutputs();

  try {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        stylePreset: stylePresetInput.value,
        styleDetail: styleDetailInput.value,
        length: lengthInput.value,
        language: languageInput.value,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }

    transcriptEl.textContent = payload.transcript || "";
    articleEl.textContent = payload.article || "";
    updateMode(payload.mode);
    truncationNote.hidden = !payload.truncated;
    setStatus("Done! Review the transcript and article below.");
  } catch (error) {
    setStatus(error.message || "Something went wrong.", true);
  } finally {
    setLoading(false);
  }
});

copyButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const targetId = button.dataset.copyTarget;
    const targetEl = document.querySelector(`#${targetId}`);
    const content = targetEl?.textContent?.trim();

    if (!content) {
      setStatus("Nothing to copy yet.", true);
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setStatus("Copied to clipboard.");
    } catch (error) {
      setStatus("Clipboard copy failed.", true);
    }
  });
});

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function updateMode(mode) {
  if (!mode) {
    modeEl.textContent = "";
    return;
  }

  modeEl.textContent =
    mode === "openai"
      ? "Generation: OpenAI"
      : "Generation: Rule-based (no API key detected)";
}

function clearOutputs() {
  transcriptEl.textContent = "";
  articleEl.textContent = "";
  truncationNote.hidden = true;
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.textContent = isLoading ? "Working..." : "Generate article";
}
