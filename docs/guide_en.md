# Eye Reflex Lab – Guide

**The optokinetic reflex experiment** · Version: 24 October 2026 · App version 2.4 · https://twe-nlb.github.io/NLB-OKR/

> **Eye Reflex Lab is a wellness and teaching app, not a medical device.** It is not intended to detect, monitor or treat any disease and does not replace a medical examination.

## 1 What it is about

When a large pattern moves steadily in front of the eyes, the eyes follow it by themselves – just like looking out of a train window. This natural reflex is called the **optokinetic reflex (OKR)**. The eyes glide along with the pattern and then jump back briefly to pick up the next stripe.

Eye Reflex Lab makes visible how the eyes follow a moving pattern: with the device’s front camera, in a few minutes. It is a hands-on experiment – for courses, teaching and the curious. Results are compared **only with one’s own earlier measurements**, never with other people.

## 2 What you need

- **Device:** iPad or iPhone with Safari, or an Android tablet or smartphone with Chrome. A tablet shows a larger stimulus area, which is more comfortable.
- **Stand:** the device stands in landscape, with the camera roughly at eye level.
- **Light:** even light from the front, no bright window behind the person.
- **Distance:** measure the distance between eyes and screen with a ruler or tape measure (default 40 cm) and always keep it the same.
- **Internet at start-up:** the app loads its face detection when it starts. Camera images never leave the device.

## 3 Open and install the app

- Open the address: https://twe-nlb.github.io/NLB-OKR/
- **Language:** choose at the top right (Deutsch, English, עברית). The choice is saved.
- **As an app on the home screen** (recommended; the app then runs full screen):
  - iPhone and iPad: in Safari, tap **Share** → **Add to Home Screen**.
  - Android: tap **Install app** in the app, or choose **Install app** in the Chrome menu ⋮.
- **Allow the camera** when the browser asks.

## 4 Two versions: Freemium and Study cases

| | Freemium | Study cases |
|---|---|---|
| Measure and view the result | ✓ | ✓ |
| Choose experimental conditions | ✓ (for the current session only) | ✓ (saved per participant) |
| Save participants and measurements | – (nothing is saved) | ✓ (on this device only) |
| Eye trace | still image of one trial | playback in slow motion, all trials, saved |
| Compare measurement series | – | ✓ |
| Export and import | – | ✓ |

- **Freemium** can be used straight away without signing up.
- **Study cases** is unlocked with an **unlock code**: on the overview under **Version**, enter the code and tap **Unlock**, or open an unlock link. The unlock applies to this device and may have an expiry date.
- If an unlock expires, saved data stay on the device and can still be exported. A new code makes them accessible again.

## 5 Set up the device (once)

So that the stimulus pattern has the same size and speed on every device, the app needs to know how large the screen is.

1. Tap **Set up device** and enter the measured **distance**.
2. **Choose the device:** iPad / iPad Air / iPad Pro, iPad mini, iPhone or iPhone SE / mini.
3. **Android and other devices:** choose **Card match to determine the screen resolution** and tap **Set the screen size with a card**:
   - Place a loyalty card or similar in credit-card size (e.g. loyalty card, library card, membership card or driving licence) flat on the screen, exactly at the marked corner of the frame.
   - Use **−** and **+** or the slider to change the frame until the frame and the card are exactly the same size, then tap **Apply**.
   - Only the size is compared. The camera is off, the card is neither read nor photographed, and nothing is entered.
   - Do not zoom in with two fingers while doing this. Repeat the match after changing the display size in the device settings.
4. **Save.**

## 6 Participants and experimental conditions

- **Add participants** (Study cases): only with a code or pseudonym, e.g. “P01”, never with a real name.
- **Experimental conditions:** in Study cases they are saved per participant and apply to all of their measurements. In Freemium they apply to the current session only.

| Setting | Default | Options |
|---|---|---|
| Stimulus pattern | Stripes | Stripes or symbols (star, moon, sun, fish, dog, rabbit, elephant, mixed) |
| Colour | Black | Black, red or blue on white |
| Width | 8° | Width of one coloured plus one white stripe; for symbols, the spacing |
| Speeds | 8 and 12 °/s | two freely selectable speeds |
| Measure vertically | off | additionally ↑ and ↓ |

The app shows measurements under different experimental conditions in a separate measurement series and does not compare them with each other.

## 7 How a measurement works

1. **Read out the instruction:** the app shows a fixed sentence that is read out word for word every time: “Look at the picture in a relaxed way. You may follow it with your eyes. Keep your head still.”
2. **Start measurement.** The **setup check** checks camera, face, open eyes, light, position and a steady head. Green and yellow are fine; red must be fixed. Once nothing has been red for 2 seconds, the app continues automatically.
3. **Calibration:** a rabbit appears in turn in the centre, on the left and on the right (with vertical measurement also at the top and bottom). The person follows it with the eyes only.
4. **Measurement:** the stimulus pattern moves alternately left and right, 3 trials per speed, each trial 8 seconds. Before each trial, a cross and an arrow show the next direction. **Tapping** pauses. The app automatically repeats invalid trials (too few detected frames or too much head movement) once at the end.
5. **Result:** appears immediately. In Study cases it is saved on the device, in Freemium it is not.

A measurement takes about 3 minutes, with vertical measurement about 5 minutes.

## 8 Understanding the result

The result consists of up to three tiles. The values describe how the eyes followed the stimulus pattern. They are an observation, not an assessment.

### Gain – the “keep-up rate”

The gain shows how fast the eyes follow the pattern: **eye velocity ÷ pattern velocity**.

- **1.0:** the eyes are exactly as fast as the pattern.
- **A picture:** the stripes are a train passing a platform, and the eyes are someone running alongside it. At 0.8 they manage 80 % of the speed, slowly fall behind and then jump forward again.
- **Example:** the pattern moves at 10 °/s and the eyes manage 8 °/s: gain = 8 ÷ 10 = 0.8.
- Below the value, the gain per direction is shown (← → ↑ ↓).

The gain depends, among other things, on how attentively and in what way someone looks, as well as on light and distance. That is why only measurements of the same person under the same experimental conditions are comparable.

### Direction difference right/left

Shows whether the eyes followed the pattern less in one direction than in the other:

- **Calculation:** (gain right − gain left) ÷ mean of both × 100 %. A positive value means the eyes followed patterns moving right better.
- **Measurement fluctuation (±):** how much the value varies between the 3 repetitions (95 % confidence interval).
- **Display:**
  - **No clear direction difference:** the difference is below 10 %.
  - **Direction difference: followed less to the right (or left):** the difference is 10 % or more and larger than the measurement fluctuation.
  - **Direction difference unclear:** the measurement fluctuation is too large for a reliable statement. Then repeat the measurement.
- The 10 % threshold is a setting of the app. Lighting, head position, distance and the device itself (the camera is not exactly in the centre) can influence such differences. Comparing several measurements is what tells you most.

### Direction difference up/down

Only with vertical measurement, calculated like right/left. An upward advantage is common, and vertical differences vary from person to person. What matters is the comparison with one’s own earlier measurements.

### Details

Under **Details** you find all trials with direction, speed, gain, the share of frames with detected eyes, the share with head movement and the quality.

| Quality | Condition |
|---|---|
| good | at least 70 % of frames with detected eyes and at most 20 % head movement |
| fair | at least 50 % and at most 40 % |
| invalid | anything below; this trial does not count |

### Eye trace

Below the result, the app shows the **eye trace** of one trial:

- **Magnified eyes**, redrawn from the facial points that the face detection delivers for each frame (eye corners, eyelid margin, iris). No camera image is shown or stored. The view is mirrored, as in a mirror: when the stimulus pattern moves right, the eyes in the view move right.
- **Strokes:** the movement of the iris over the last second or so runs downward like the trace of a chart recorder (sideways for vertical measurement). **Gliding** (slow phase, blue) appears as a slanted stroke, the **jump back** (fast phase, orange) as a counter-stroke. Because the movement is only fractions of a millimetre, the strokes are magnified in the direction of motion; the factor is shown in the image. The strokes show the average of both eyes; gliding is slightly smoothed.
- **Width of the reflex movement:** the length of a counter-stroke shows how far the eye glided along before jumping back. This width is shown in mm next to each counter-stroke. Below the image, the app shows the average width of all jumps back in the trial in mm and degrees, with the measurement fluctuation (±).
- **Curve:** eye position over time with a time cursor, degrees on the left, mm on the right.
- **Values:** average width of the reflex movement (see above), gliding in °/s and mm/s, and the measurement fluctuation per frame.
- **Degrees and mm:** degrees come from the calibration. The app estimates millimetres from the iris diameter, which is about 11.7 mm in adults. Single frames vary by roughly the stated measurement fluctuation; values over many frames are more precise. The second decimal place of a single counter-stroke is therefore only approximate; the average width over many jumps back is more precise.
- **Freemium:** still image of one trial as a taster. **Study cases:** playback in slow motion (¼×, ½×, 1×), time slider, choice of trial; the eye trace is saved with the measurement and can be viewed again at any time.
- The eye trace is available for measurements from app version 2.4 on. Older measurements show a curve in degrees under **Details**.

### First measurement and comparison (Study cases)

A participant’s **first measurement** under given experimental conditions is the reference point. For every further measurement, the app shows the difference from the first measurement. The participant’s page shows all measurements as a measurement series with charts and a table.

## 9 Tips for comparable measurements

- Same device, same distance, same experimental conditions.
- Read out the instruction word for word every time.
- Similar time of day and the same light.
- Keep the head still, device in the stand.
- At the start, measure on several different days. This shows how much one’s own values vary from day to day.
- Only compare trials of good quality.

## 10 Limits

- The front camera delivers about 30 frames per second. The app captures the slow gliding of the eyes well, the short jumps back only roughly.
- The mm values of the eye trace are based on an average iris diameter. It may differ slightly in individual people; for comparing the same person this does not matter.
- The app averages both eyes. It does not show differences between the eyes.
- The screen covers only part of the visual field. The values cannot be compared with other measuring methods.
- The app does not compare people with each other and has no reference values.

## 11 Data and privacy

- Camera images never leave the device. The app sends nothing to a server and stores no video.
- **Freemium** saves no participants and no measurements. Only settings such as language and device setup are saved.
- **Study cases** saves participants (code or pseudonym only) and measurements **on the device**. The eye trace adds 17 facial points per eye and frame (eye corners, eyelid margin, iris), about 1 MB per measurement, but no images.
  - **Export** opens the share menu (e.g. Files, AirDrop, cloud storage). Each measurement is saved as a JSON file (complete, can be imported again) and as a CSV file (for Excel, number format matching the language).
  - **Import** loads JSON files back, e.g. onto another device.
  - The browser may delete website data after a long period of non-use. Please export regularly.

## 12 If something does not work

| Problem | Solution |
|---|---|
| No camera access | iPhone/iPad: Settings → Safari → allow Camera. Android: in Chrome, the icon to the left of the address → Permissions → Camera; in the installed app via App info → Permissions. Then reload. |
| Setup check stays red | More light from the front, face in the centre of the image, remove reflective glasses if needed, keep the head still. |
| Calibration not OK | Follow the rabbit with the eyes only, do not turn the head. Then tap **Repeat**. |
| Hint “please come a little closer” / “move back a little” | Bring the distance back to the value set up for the device. |
| Unlock code is not accepted | Enter the code exactly as you received it (upper/lower case and hyphens do not matter). Expired codes are no longer valid. |
| Blank page | Reload the page. If that does not help: clear the browser history and website data for this page (export first). |

---

Eye Reflex Lab is a wellness and teaching app, not a medical device. It is not intended to detect, monitor or treat any disease and does not replace a medical examination.
