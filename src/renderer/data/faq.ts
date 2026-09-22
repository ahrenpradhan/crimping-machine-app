export interface FaqItem {
  q: string;
  a: string[];
}

export interface FaqSection {
  title: string;
  items: FaqItem[];
}

/** Content of the Guide screen. Plain text - edit freely. */
export const FAQ_SECTIONS: FaqSection[] = [
  {
    title: 'Getting started',
    items: [
      {
        q: 'What can this app do, and how do I move around?',
        a: [
          'It has two crimp modes: CRIMP BY LINEAR (set-up: the ram stops at a target die diameter) and CRIMP BY PRESSURE (production: the ram stops at a target pressure). It also keeps recipes, a history of every crimp cycle and separate profiles.',
          'The home screen has a tile for each area. On every other screen the bottom bar has the same options plus HOME, so any screen is one tap away. A crimp that is running keeps running when you leave the crimp screen - its tab in the bottom bar shows RUNNING.',
        ],
      },
      {
        q: 'The screen looks different on my panel (small or large).',
        a: [
          'The app adapts to the screen. On a small 7" panel (800x480) the crimp screen shows PARAMETERS and GRAPHS on two tabs - tap a tab to switch; the live values, the status and START / STOP stay on screen. On a 10" panel the parameters and the small graphs are side by side. On a large 12"+ panel everything is drawn bigger.',
          'Nothing is lost on a small panel: every value and button is the same, only arranged differently.',
        ],
      },
      {
        q: 'What do SIMULATION and the sensor indicator in the header mean?',
        a: [
          'SIMULATION means no real machine is connected: pressure and displacement are simulated and nothing physical is switched. The sensor indicator shows the state of the two transducers and how often they are read (in Hz). START only works while the sensors are OK.',
        ],
      },
      {
        q: 'How do I switch between dark and light mode?',
        a: [
          'Tap the sun / moon icon at the far right of the header. Dark is the default (best in low light near the machine); light suits a bright shop floor. The choice is remembered on this device, so it stays set after a restart.',
        ],
      },
    ],
  },
  {
    title: 'Crimp screens',
    items: [
      {
        q: 'How do I crimp by linear?',
        a: [
          'Open CRIMP BY LINEAR. Set the target diameter, the correction and the hold time (die size and open diameter are set once for the die), then press START. The ram closes until the die reaches the target diameter (plus the correction) and stops. The screen shows the stroke this equals ("Stops at ... mm diameter = ... mm stroke").',
        ],
      },
      {
        q: 'What does the correction do?',
        a: [
          'It is added to the target diameter to trim out spring-back. Measure a finished piece: if it is too small, enter a positive correction (stops earlier); if it is too large, enter a negative one (crimps further).',
        ],
      },
      {
        q: 'How do I crimp by pressure?',
        a: [
          'Open CRIMP BY PRESSURE, or load a recipe first (see Recipes). Set the target pressure, then press START. The ram closes and stops when the pressure reaches the target. Pieces that end outside the accepted diameter window are counted as Bad.',
        ],
      },
      {
        q: 'What are die size and open diameter? What is TEACH?',
        a: [
          'Both belong to the die, so they are the same in both modes and sit in the same place on both screens. The die diameter shown at the top is the open diameter minus the ram stroke.',
          'To teach: open the die fully, then press TEACH (next to "Open diameter") and press it again when it says TAP AGAIN. The current ram position becomes zero stroke, so the readout matches the open diameter you entered. It only works while the machine is idle and the sensors are OK.',
        ],
      },
      {
        q: 'What is the slow-down point (pressure mode)?',
        a: [
          'The ram closes fast, then switches to slow when the die diameter falls to the "slow down at diameter" or the pressure reaches the "slow down at pressure", whichever comes first. It stays slow up to the target pressure.',
        ],
      },
      {
        q: 'What is the accepted diameter (min / max)?',
        a: [
          'It is the window the finished piece must be in. When the target pressure is reached the die diameter is checked: outside the window the cycle is flagged OUT OF TOLERANCE and counted as Bad, and it shows as BAD in the history.',
        ],
      },
      {
        q: 'What does the hold time do?',
        a: [
          'It is the dwell after the target is reached. The output has already stopped at the target; the cycle only completes after the hold time, and the graphs keep recording during it so you can see where the ram really stopped.',
        ],
      },
      {
        q: 'Why can I not change a value, or why is START greyed out?',
        a: [
          'The parameters of a mode are locked while a cycle of that mode is running (the other mode can still be edited). START is disabled while a cycle is running, while a fault is active, or when the sensors are not OK.',
          'START is also refused if the die is already at or below the target diameter (linear) or the pressure is already at the target (pressure) - open the machine first. The reason is shown under the status.',
        ],
      },
      {
        q: 'What do Good / Bad / Total mean?',
        a: [
          'Good counts every completed crimp that is not out of tolerance. Bad counts pressure-mode crimps that ended outside the accepted diameter, plus every piece you mark with the + button after measuring. + only adds to Bad - it does not take a piece away from Good. RESET needs two taps. The counters are cleared when the app restarts.',
          'A + press is also written to the history: that cycle shows as BAD, "Rejected by operator".',
        ],
      },
    ],
  },
  {
    title: 'Graphs',
    items: [
      {
        q: 'How do I enlarge a graph? What are CYCLE / LIVE and the auto-switch?',
        a: [
          'The three graphs on the right are small tiles - tap one to open it full screen. In the full-screen view use the tabs to change graph and CLOSE (or Esc) to go back. A dashed red line marks the target.',
          'CYCLE shows the current / last crimp cycle (it stays after the cycle ends). LIVE shows the last 10 seconds.',
          'With "Auto-switch to cycle view on START" ON, every START jumps the graphs back to CYCLE. Turn it OFF to keep the graphs on LIVE (or CYCLE) - they then change only when you press CYCLE / LIVE. The setting is remembered.',
        ],
      },
    ],
  },
  {
    title: 'Recipes and history',
    items: [
      {
        q: 'How do I make a recipe?',
        a: [
          'Run a crimp in CRIMP BY LINEAR until the piece is right. When the cycle is COMPLETE a SAVE AS RECIPE button appears under the status. Give it a name and the accepted diameter tolerance and save.',
          'The recipe stores the pressure that crimp needed, the diameter it reached (as an accepted +/- window), the die setup, the hold time and a slow-down point worked out from them. Recipes belong to the active profile.',
        ],
      },
      {
        q: 'How do I run production with a recipe?',
        a: [
          'Open RECIPES, pick the recipe and press USE IN PRESSURE MODE. CRIMP BY PRESSURE opens with the recipe loaded; press START for every piece.',
          'If you change a value the recipe bar turns amber ("modified") and RESTORE reloads the saved values. Every cycle is filed under the recipe, and the history also notes whether the values were edited.',
        ],
      },
      {
        q: 'How do I see what a recipe has produced?',
        a: [
          'On the RECIPES screen each recipe shows its cycles, good, bad and last run. Press VIEW HISTORY for the full table: one row per cycle, newest first, with the result (GOOD / BAD / STOPPED / FAULT), target, final and at-target diameter, final and peak pressure, stroke, duration, hold, slow-down, whether the recipe values were edited, and notes such as "Diameter out of tolerance". LOAD MORE shows older cycles; REFRESH updates the table.',
        ],
      },
      {
        q: 'What is recorded for each crimp, and where is it kept?',
        a: [
          'Every finished cycle, in both modes and whether it completed, was stopped or faulted, is saved in a database file on this computer: the profile and recipe, the parameters used, the result and the pressure / displacement values, plus the full trace of the cycle. The Profile screen shows the database file location.',
          'Deleting a recipe removes it from the list; its past cycles stay in the database.',
        ],
      },
    ],
  },
  {
    title: 'Profiles',
    items: [
      {
        q: 'How do I create or change a profile?',
        a: [
          'Open PROFILE. Tap a profile to switch to it, or type a name under NEW PROFILE and press CREATE - the new profile is selected straight away. Names are 1 to 30 characters and must be different from existing ones (capitals are ignored).',
          'Recipes and cycle history are kept per profile, so switching profile shows that profile\'s recipes. Switching is blocked while a crimp is running. The selected profile is remembered when the app restarts. A profile is a workspace, not a login - there are no passwords.',
        ],
      },
    ],
  },
  {
    title: 'Problems and safety',
    items: [
      {
        q: 'The machine shows FAULT.',
        a: [
          'A fault stops closing. Typical causes are a sensor or wiring problem, the displacement limit or the pressure limit being exceeded, or "Cycle timeout - target not reached". The fault text is shown under the status. Fix the cause, then press RESET FAULT (the STOP button changes to it).',
        ],
      },
      {
        q: 'The Profile screen says "Database problem".',
        a: [
          'Recipes and history cannot be saved or read, so the recipe list may be empty and new cycles are not recorded. The machine screens keep working. The message on the Profile screen says what is wrong; it usually means the database component was not installed correctly for this app - ask whoever set the app up to re-run the install step.',
        ],
      },
      {
        q: 'Is this a safety system?',
        a: [
          'No. This is a prototype. The emergency stop must be hard-wired, and in this version the machine output is simulated or log-only - nothing physical is switched.',
        ],
      },
    ],
  },
];
