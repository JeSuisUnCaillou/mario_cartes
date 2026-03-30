export function initHome() {
  document.getElementById("app").innerHTML = `
    <div class="home-container">
      <h1>Mario Cartes</h1>
      <button id="create-btn">Create game</button>
    </div>
  `;

  document.getElementById("create-btn").addEventListener("click", async () => {
    const res = await fetch("/create");
    const { id } = await res.json();
    window.location.href = `/game/${id}/board`;
  });
}
