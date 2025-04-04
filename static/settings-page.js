document.addEventListener("DOMContentLoaded", () => {
  const settings = Settings();
  const controls = ["units"];

  // Set up controls with their current values.
  controls.forEach((c) => {
    const control = document.querySelector(`#${c}-control`);
    control.value = settings.get(c);
  });

  const save_button = document.querySelector("#save-button");

  save_button.addEventListener("click", (e) => {
    controls.forEach((c) => {
      const control = document.querySelector(`#${c}-control`);
      settings.set(c, control.value);
    });
  });
});
