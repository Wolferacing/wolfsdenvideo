if(window.isBanter) {
  const now = Date.now();
  // Define a list of welcome messages
  const welcomeMessages = [
    "has joined the space",
    "arrived",
    "is here",
    "beamed in",
    "has glitched into the matrix!",
    "just teleported in.",
    "has joined. Quick, Hide your avatars.",
    "just dropped in from another dimension",
    "has entered the simulation!",
    "has logged into the mainframe!",
    "is now part of our virtual mischief",
    "just crossed the digital threshold",
    "decided to join us in the simulation. Alert the media, this is groundbreaking stuff.",
    "just stumbled into our virtual realm. Someone hold their hand, they look lost.",
    "is wanted in several other spaces. Take cover and shoot!",
    "is here for cuddles and milk and is all out of cuddles"
  ];

  window.userJoinedCallback = async user => {
    if(Date.now() - now > 30000) {
      const name = (user.name ? user.name : user.id.substr(0, 6));
      // Select a random welcome message from the list
      const randomWelcomeMessage = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
      const message = name + " " + randomWelcomeMessage; // Concatenate the name with the chosen welcome message
      const welcome = await fetch('https://say-something.glitch.me/say/' + encodeURIComponent(message)); // Make sure to encode the message for URL
      const url = await welcome.text();
      const audio = new Audio("data:audio/mpeg;base64," + url);
      audio.autoplay = true;
      audio.play();
      audio.volume = 0.08;
    }
  }
}
