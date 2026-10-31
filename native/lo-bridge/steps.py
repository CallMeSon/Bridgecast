"""Click counter for a slide show that has no GetClickIndex (LibreOffice Impress).

The bridge counts the `next`/`prev` effects it sends itself and corrects the count whenever
the show reports (or is seen to be on) another slide. The engine position always wins in the
app, so this only has to be right in the normal cases and recover by itself otherwise.
"""


class StepCounter:
    def __init__(self, index=0, clicks=0):
        self.index = index
        self.clicks = clicks
        self.step = 0
        # prev was asked at step 0: if the slide changes now, we arrive at the end of the other slide.
        self._backwards = False

    def on_next_effect(self):
        """`gotoNextEffect` was sent. At the last click it leaves the slide: the step stays and the
        slide change resets it."""
        self._backwards = False
        if self.step < self.clicks:
            self.step += 1

    def on_prev_effect(self):
        """`gotoPreviousEffect` was sent. Inside a slide it undoes one click; at step 0 it goes to
        the previous slide with all its effects done."""
        if self.step > 0:
            self.step -= 1
            self._backwards = False
        else:
            self._backwards = True

    def on_slide_changed(self, index, clicks):
        """The show is on slide `index` (which has `clicks` clicks). The same slide changes nothing
        except the click count."""
        if index == self.index:
            self.clicks = clicks
            self.step = min(self.step, clicks)
            self._backwards = False
            return
        self.step = clicks if self._backwards else 0
        self.index = index
        self.clicks = clicks
        self._backwards = False

    def position(self):
        """(slide index, step, clicks of the slide)."""
        return (self.index, self.step, self.clicks)
