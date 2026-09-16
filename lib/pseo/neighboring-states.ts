/**
 * lib/pseo/neighboring-states.ts
 *
 * The ONE adjacency table for "nearby states" copy and cross-links. Until
 * the thin-content program this table existed three times (the setting-state
 * config, the setting-state template through that config, and a private copy
 * on the state hub page); every consumer is meant to import this module so
 * the lists cannot drift.
 *
 * COPY RULE: the lists are proximity, not borders. Alaska and Hawaii list
 * West Coast states, so visible copy built from this table says "nearby
 * states", never "bordering" or "borders".
 */

export const NEIGHBORING_STATES: Readonly<Record<string, readonly string[]>> = {
  'Alabama': ['Florida', 'Georgia', 'Tennessee', 'Mississippi'],
  'Alaska': ['Washington', 'California', 'Oregon'],
  'Arizona': ['California', 'Nevada', 'Utah', 'Colorado', 'New Mexico'],
  'Arkansas': ['Texas', 'Oklahoma', 'Missouri', 'Tennessee', 'Mississippi', 'Louisiana'],
  'California': ['Oregon', 'Nevada', 'Arizona', 'Washington'],
  'Colorado': ['Utah', 'Wyoming', 'Nebraska', 'Kansas', 'Oklahoma', 'New Mexico', 'Arizona'],
  'Connecticut': ['New York', 'Massachusetts', 'Rhode Island'],
  'Delaware': ['Pennsylvania', 'New Jersey', 'Maryland'],
  'District of Columbia': ['Maryland', 'Virginia'],
  'Florida': ['Georgia', 'Alabama'],
  'Georgia': ['Florida', 'Alabama', 'Tennessee', 'North Carolina', 'South Carolina'],
  'Hawaii': ['California', 'Washington', 'Oregon'],
  'Idaho': ['Washington', 'Oregon', 'Montana', 'Wyoming', 'Utah', 'Nevada'],
  'Illinois': ['Wisconsin', 'Indiana', 'Kentucky', 'Missouri', 'Iowa'],
  'Indiana': ['Michigan', 'Ohio', 'Kentucky', 'Illinois'],
  'Iowa': ['Minnesota', 'Wisconsin', 'Illinois', 'Missouri', 'Nebraska', 'South Dakota'],
  'Kansas': ['Nebraska', 'Missouri', 'Oklahoma', 'Colorado'],
  'Kentucky': ['Indiana', 'Ohio', 'West Virginia', 'Virginia', 'Tennessee', 'Missouri', 'Illinois'],
  'Louisiana': ['Texas', 'Arkansas', 'Mississippi'],
  'Maine': ['New Hampshire', 'Massachusetts'],
  'Maryland': ['Pennsylvania', 'Delaware', 'Virginia', 'West Virginia', 'District of Columbia'],
  'Massachusetts': ['New Hampshire', 'Vermont', 'New York', 'Connecticut', 'Rhode Island'],
  'Michigan': ['Ohio', 'Indiana', 'Wisconsin'],
  'Minnesota': ['Wisconsin', 'Iowa', 'South Dakota', 'North Dakota'],
  'Mississippi': ['Louisiana', 'Arkansas', 'Tennessee', 'Alabama'],
  'Missouri': ['Iowa', 'Illinois', 'Kentucky', 'Tennessee', 'Arkansas', 'Oklahoma', 'Kansas', 'Nebraska'],
  'Montana': ['North Dakota', 'South Dakota', 'Wyoming', 'Idaho'],
  'Nebraska': ['South Dakota', 'Iowa', 'Missouri', 'Kansas', 'Colorado', 'Wyoming'],
  'Nevada': ['California', 'Oregon', 'Idaho', 'Utah', 'Arizona'],
  'New Hampshire': ['Maine', 'Vermont', 'Massachusetts'],
  'New Jersey': ['New York', 'Pennsylvania', 'Delaware'],
  'New Mexico': ['Arizona', 'Utah', 'Colorado', 'Oklahoma', 'Texas'],
  'New York': ['Vermont', 'Massachusetts', 'Connecticut', 'New Jersey', 'Pennsylvania'],
  'North Carolina': ['Virginia', 'Tennessee', 'Georgia', 'South Carolina'],
  'North Dakota': ['Montana', 'South Dakota', 'Minnesota'],
  'Ohio': ['Michigan', 'Indiana', 'Kentucky', 'West Virginia', 'Pennsylvania'],
  'Oklahoma': ['Kansas', 'Missouri', 'Arkansas', 'Texas', 'New Mexico', 'Colorado'],
  'Oregon': ['Washington', 'California', 'Nevada', 'Idaho'],
  'Pennsylvania': ['New York', 'New Jersey', 'Delaware', 'Maryland', 'West Virginia', 'Ohio'],
  'Rhode Island': ['Massachusetts', 'Connecticut'],
  'South Carolina': ['North Carolina', 'Georgia'],
  'South Dakota': ['North Dakota', 'Minnesota', 'Iowa', 'Nebraska', 'Wyoming', 'Montana'],
  'Tennessee': ['Kentucky', 'Virginia', 'North Carolina', 'Georgia', 'Alabama', 'Mississippi', 'Arkansas', 'Missouri'],
  'Texas': ['New Mexico', 'Oklahoma', 'Arkansas', 'Louisiana'],
  'Utah': ['Idaho', 'Wyoming', 'Colorado', 'New Mexico', 'Arizona', 'Nevada'],
  'Vermont': ['New Hampshire', 'Massachusetts', 'New York'],
  'Virginia': ['Maryland', 'District of Columbia', 'West Virginia', 'Kentucky', 'Tennessee', 'North Carolina'],
  'Washington': ['Oregon', 'Idaho'],
  'West Virginia': ['Pennsylvania', 'Maryland', 'Virginia', 'Kentucky', 'Ohio'],
  'Wisconsin': ['Michigan', 'Minnesota', 'Iowa', 'Illinois'],
  'Wyoming': ['Montana', 'South Dakota', 'Nebraska', 'Colorado', 'Utah', 'Idaho'],
};

/** Nearby states for a full state name, in table order; [] for unknown names. */
export function getNeighboringStates(stateName: string): readonly string[] {
  return NEIGHBORING_STATES[stateName] ?? [];
}
