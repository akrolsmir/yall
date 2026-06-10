Create a public wiki, UI, and database for every single person in a field (such as “EA” or “AI Safety”)

- **Upload**: Have an admin interface to upload a csv of names (+ optionally emails), and to write in the description of the source of those people emails, for context (eg “attendees of Manifest 2025”)
    - To start, seed it with the following people:
        - Austin Chen
        - Rachel Weinberg
        - Oliver Habryka
        - Rachel Shu
- **Profile**: For each person, make it easy to run an agent which scrapes the internet and constructs a public profile for that person
    - the profile should have an accessible slug, eg for “Alice Smith” ⇒ `/p/alice-smith`
    - the profile should have a 1 sentence bio, a couple paragraph summary, and a long (maybe 1000 word) wikipedia-style article
    - the profile should link to their most common web presences
    - the profile should have a light amount of structured data, including
        - primary org they work at
        - other org affiliations
        - general field affiliations eg “technical AI safety”, “agent foundations”, “EA fieldbuilding”
        - (don’t canonicalize these tags yet, just use plaintext)
- The admin interface and code setup should make it easy to kick off a batch job to construct profiles for eg 100 people at a time.
- **Auth:** individuals can sign in to claim a profile & edit it
- **UI:** on the homepage, start with a table view + in-memory search over names, and some reasonable filtering options

Design constraints:

- Should be fast. Use InstantDB.
- At the start, should work easily with 10k+ people
- Start with a simple theme; we’ll modify this later

Future work (consider while designing the system, but don’t implement yet)

- **AI Chat**: Create a general AI chat interface that supports a variety of features, including:
    - pasting in a listing (eg job listing, or request for conference speakers), and then returns a table of potential matches
    - helping construct an outreach message to specific candidates, in your own voice
    - identifying the most thoughtful way to reach a specific candidate (eg shared contacts)
- **Digital Twin:** “speak with a digital twin of [Alice Smith]”, a feature from her profile page

### Names

codename “Bagel”, official name to be chosen later

- roster
- everyone, all,
- plenty
- peoplewiki, kiwi