function Settings() {
  // The list of values and their defaults.
  const Values = {
    units: "imperial",
  };

  function get(key) {
    if ((!key) in Values) {
      throw new Error(`Unknown setting ${key}`);
    }

    return localStorage.getItem(`setting:${key}`) ?? Values[key];
  }

  function set(key, value) {
    if (get(key) !== value) {
      localStorage.setItem(`setting:${key}`, value);
    }
  }

  return {
    get,
    set,
  };
}
