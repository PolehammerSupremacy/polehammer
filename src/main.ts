import { Chart, ChartData, registerables } from "chart.js";
import ALL_WEAPONS, { weaponByName } from "./all_weapons";
import { MetricLabel, Unit } from "./metrics";
import {
  generateMetrics,
  hasBonus,
  unitGroupStats,
  UnitStats,
  WeaponStats,
} from "./stats";
import "./style.css";
import { Target } from "./target";
import { borderDash, weaponColor, weaponDash } from "./ui";
import { shuffle } from "./util";
import { bonusMult, Weapon } from "./weapon";

Chart.defaults.font.family = "'Lato', sans-serif";
Chart.register(...registerables); // the auto import stuff was making typescript angry.

const STATS: WeaponStats = generateMetrics(ALL_WEAPONS);
const UNIT_STATS: UnitStats = unitGroupStats(STATS);

let selectedTarget = Target.AVERAGE;
const selectedWeapons: Set<Weapon> = new Set<Weapon>();
const selectedCategories: Set<MetricLabel> = new Set<MetricLabel>();
const searchResults: Set<Weapon> = new Set<Weapon>();

const weaponSearchResults = document.getElementById(
  "weaponSearchResults"
) as HTMLDivElement;
const displayedWeapons = document.getElementById(
  "displayedWeapons"
) as HTMLFieldSetElement;

function toId(str: string) {
  return str
    .replaceAll(" ", "_")
    .replaceAll("/", "-")
    .replaceAll("(", ":")
    .replaceAll(")", ":");
}

// Normalization will only occur for stat types that have a unit present in the provided normalizationStats.
// This allows for selective normalization, like for bar charts where we wan't mostly raw data, except for
// "speed" (or other inverse metrics) which only make sense as a normalized value
function chartData(
  dataset: WeaponStats,
  categories: Set<MetricLabel>,
  normalizationStats: UnitStats,
  setBgColor: boolean
): ChartData {
  return {
    labels: [...categories],
    datasets: [...selectedWeapons].map((w) => {
      return {
        label: w.name,
        data: [...categories].map((c) => {
          const metric = dataset.get(w)!.get(c)!;
          let value = metric.value;
          if (hasBonus(c)) {
            value *= bonusMult(selectedTarget, w.damageType);
          }

          const maybeUnitStats = normalizationStats.get(metric.unit);
          if (maybeUnitStats) {
            const unitMin = maybeUnitStats!.min;
            const unitMax = maybeUnitStats!.max;

            // Normalize
            return (value - unitMin) / (unitMax - unitMin);
          }
          return value;
        }),
        backgroundColor: setBgColor ? weaponColor(w) : "transparent",
        borderColor: weaponColor(w),
        borderDash: borderDash(w),
      };
    }),
  };
}

const radar: Chart = new Chart(
  document.getElementById("radar") as HTMLCanvasElement,
  {
    type: "radar",
    options: {
      animation: false,
      plugins: {
        legend: {
          display: false,
          position: "bottom",
        },
      },
      responsive: true,
      maintainAspectRatio: true,
      scales: {
        radial: {
          min: 0,
          max: 1,
          ticks: {
            display: false,
            maxTicksLimit: 2,
          },
        },
      },
    },
    data: chartData(STATS, selectedCategories, UNIT_STATS, false),
  }
);

const bars = new Array<Chart>();

function createBarChart(element: HTMLCanvasElement, category: MetricLabel) {
  const stats: UnitStats = new Map();
  stats.set(Unit.SPEED, UNIT_STATS.get(Unit.SPEED)!);

  return new Chart(element as HTMLCanvasElement, {
    type: "bar",
    options: {
      animation: false,
      plugins: {
        legend: {
          display: false,
        },
      },
      responsive: true,
      maintainAspectRatio: false,
    },
    data: chartData(STATS, new Set([category]), stats, true),
  });
}

function redrawBars() {
  const barsElem = document.getElementById("bars")!;
  bars.forEach((b) => b.destroy());
  while (barsElem.firstChild) {
    barsElem.removeChild(barsElem.firstChild);
  }

  bars.splice(0, bars.length);

  selectedCategories.forEach((c) => {
    const outer = document.createElement("div");
    outer.className = "col-md-4";
    outer.id = c;
    const elem = document.createElement("canvas");
    outer.appendChild(elem);
    barsElem.appendChild(outer);
    bars.push(createBarChart(elem, c));
  });
}

function redraw() {
  radar.data = chartData(STATS, selectedCategories, UNIT_STATS, false);
  radar.update();

  redrawBars();

  // Update content of location string so we can share
  const params = new URLSearchParams();
  params.set("target", selectedTarget);
  [...selectedWeapons].map((w) => params.append("weapon", w.name));
  [...selectedCategories].map((c) => params.append("category", c));
  window.history.replaceState(null, "", `?${params.toString()}`);
}

function addWeaponDiv(weapon: Weapon) {
  const div = document.createElement("div");
  div.id = weapon.name;
  div.className = "labelled-input";
  div.style.display = "flex";
  div.style.alignItems = "center";

  const input = document.createElement("input");
  input.id = `input-${weapon.name}`;
  input.checked = true;
  input.type = "checkbox";
  input.onchange = () => {
    removeWeapon(weapon);
  };
  div.appendChild(input);

  const label = document.createElement("label");
  label.htmlFor = `input-${weapon.name}`;
  label.innerText = weapon.name;
  label.style.padding = "0.2em";
  label.style.border = `3px ${weaponDash(weapon)} ${weaponColor(weapon)}`;
  div.appendChild(label);

  displayedWeapons.appendChild(div);
}

// Add an input checkbox with a border to show the weapon has been added
// Allow the weapon to be removed by unchecking the checkbox
function addWeapon(weapon: Weapon) {
  addWeaponDiv(weapon);

  selectedWeapons.add(weapon);
  redraw();

  updateSearchResults();
}

function removeWeapon(weapon: Weapon) {
  displayedWeapons.removeChild(document.getElementById(weapon.name)!);

  selectedWeapons.delete(weapon);
  redraw();

  updateSearchResults();
}

const weaponSearch = document.getElementById(
  "weaponSearch"
) as HTMLInputElement;
weaponSearch.onfocus = () => {
  weaponSearchResults.style.display = "initial";
};
weaponSearch.onblur = () => {
  // Clear search when clicking out
  weaponSearch.value = "";
  updateSearchResults();

  weaponSearchResults.style.display = "none";
};
weaponSearch.oninput = updateSearchResults;

function setCategory(category: MetricLabel, enabled: boolean) {
  const checkbox = document.getElementById(toId(category)) as HTMLInputElement;

  // Manually typing into URL, or old URL and we've changed category names
  if (!checkbox) {
    return;
  }

  checkbox.checked = enabled;

  if (enabled) {
    selectedCategories.add(category);
  } else {
    selectedCategories.delete(category);
  }
  redraw();
}

// Write all categories we know about into the categories list
Object.values(MetricLabel).forEach((r) => {
  const [group, name] = r.split(" - ");

  const div = document.createElement("div");

  const input = document.createElement("input");
  input.id = toId(r);
  input.checked = selectedCategories.has(r);
  input.setAttribute("type", "checkbox");
  input.onclick = (ev) => {
    const enabled = (ev.target as HTMLInputElement).checked;
    setCategory(r, enabled);
  };
  div.className = "labelled-input";
  div.appendChild(input);

  const label = document.createElement("label");
  label.htmlFor = toId(r);
  label.innerText = name;
  div.appendChild(label);

  const categoryGroup = document.getElementById(
    `category-${group.toLowerCase()}`
  ) as HTMLFieldSetElement;
  categoryGroup.appendChild(div);
});

// Clear all weapon selections
function clear() {
  selectedWeapons.clear();
  redraw();

  while (displayedWeapons.firstChild) {
    displayedWeapons.removeChild(displayedWeapons.firstChild);
  }

  updateSearchResults();
}

// Choose 3 random weapons
function random() {
  clear();
  const random = shuffle(ALL_WEAPONS);
  random.slice(0, 3).forEach(addWeapon);
}

// Choose all weapons
function all() {
  clear();
  ALL_WEAPONS.forEach((w) => {
    selectedWeapons.add(w);
    addWeaponDiv(w);
  });
  updateSearchResults();
  redraw();
}

// Reset to default category selections
// Clear all weapon selections
function reset() {
  selectedCategories.clear();
  selectedCategories.add(MetricLabel.SPEED_AVERAGE);
  selectedCategories.add(MetricLabel.RANGE_AVERAGE);
  selectedCategories.add(MetricLabel.DAMAGE_AVERAGE);
  Object.values(MetricLabel).map((r) => {
    const checkbox = document.getElementById(toId(r)) as HTMLInputElement;
    checkbox.checked = selectedCategories.has(r);
  });
  redraw();
}

// Link up to buttons
document.getElementById("clear")!.onclick = clear;
document.getElementById("random")!.onclick = random;
document.getElementById("all")!.onclick = all;
document.getElementById("reset")!.onclick = reset;

// Link up Share button
document.getElementById("share")!.onclick = () => {
  navigator.clipboard.writeText(window.location.toString());
  alert("Copied to clipboard!");
};

// Use query string to init values if possible
const params = new URLSearchParams(location.search);
if (params.get("target")) {
  selectedTarget = params.get("target") as Target;
}

if (params.getAll("weapon").length) {
  params.getAll("weapon").map((name) => {
    const weapon = weaponByName(name);
    if (weapon) addWeapon(weapon);
  });
} else {
  random();
}

if (params.getAll("category").length) {
  params.getAll("category").map((c) => setCategory(c as MetricLabel, true));

  // Setting them failed, so just default
  if (!selectedCategories.size) {
    reset();
  }
} else {
  reset();
}

// Link up target radio buttons
Object.values(Target).forEach((t) => {
  const radio = document.getElementById(toId(t)) as HTMLInputElement;
  radio.onclick = () => {
    selectedTarget = t;
    redraw();
  };
  radio.checked = selectedTarget === t;
});

// - Take into account weapons that are already selected
// - Take into account any filters that are applied
// - Clear out existing buttons and write new ones depending on the results
// - If no results, have special entry
function updateSearchResults() {
  // Start assuming no search results
  searchResults.clear();

  // Take search text into account
  const searchText = weaponSearch.value?.toLowerCase();
  if (searchText) {
    ALL_WEAPONS.forEach((w) => {
      if (w.name.toLowerCase().includes(searchText)) {
        searchResults.add(w);
      }
    });
  } else {
    ALL_WEAPONS.forEach((w) => searchResults.add(w));
  }

  // Remove any we already have selected
  selectedWeapons.forEach((w) => searchResults.delete(w));

  // Clear existing buttons
  while (weaponSearchResults.firstChild) {
    weaponSearchResults.removeChild(weaponSearchResults.firstChild);
  }

  // Add a button for each search result
  searchResults.forEach((w) => {
    const button = document.createElement("button");
    button.className = "searchResult";
    button.innerText = w.name;
    button.onmousedown = (ev) => ev.preventDefault(); // Stop the blur from occurring that will hide the button itself
    button.onclick = () => addWeapon(w);
    weaponSearchResults.appendChild(button);
  });
}

updateSearchResults();
