async function sendMessage() {
  const input = document.getElementById("userInput");
  const chatLog = document.getElementById("chatLog");
  const message = input.value.trim();

  if (!message) return;

  // Show user message
  chatLog.innerHTML += `<div class="user"><strong>You:</strong> ${message}</div>`;
  input.value = "";

  try {
    const response = await fetch("https://YOUR_BACKEND_URL/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message })
    });

    const data = await response.json();

    if (data.reply) {
      chatLog.innerHTML += `<div class="bot"><strong>ChatrBot:</strong> ${data.reply}</div>`;
    } else {
      chatLog.innerHTML += `<div class="bot error">Sorry, something went wrong.</div>`;
    }
  } catch (err) {
    chatLog.innerHTML += `<div class="bot error">Connection error. Please try again.</div>`;
  }

  chatLog.scrollTop = chatLog.scrollHeight;
}

