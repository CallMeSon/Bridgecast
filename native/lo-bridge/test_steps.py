import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from steps import StepCounter  # noqa: E402


class StepCounterTest(unittest.TestCase):
    def test_three_next_effects_then_slide_change(self):
        c = StepCounter(0, 3)
        for expected in (1, 2, 3):
            c.on_next_effect()
            self.assertEqual(c.position(), (0, expected, 3))
        c.on_next_effect()  # at the last click: leaves the slide, step stays until the change
        self.assertEqual(c.position(), (0, 3, 3))
        c.on_slide_changed(1, 1)
        self.assertEqual(c.position(), (1, 0, 1))

    def test_prev_from_step_zero_lands_at_clicks(self):
        c = StepCounter(2, 0)
        c.on_prev_effect()
        c.on_slide_changed(1, 4)
        self.assertEqual(c.position(), (1, 4, 4))

    def test_prev_inside_a_slide_goes_back_one_step(self):
        c = StepCounter(0, 3)
        c.on_next_effect()
        c.on_next_effect()
        c.on_prev_effect()
        self.assertEqual(c.position(), (0, 1, 3))
        c.on_prev_effect()
        c.on_prev_effect()  # step 0: the next change is backwards
        c.on_slide_changed(0, 3)  # same slide (first slide has nowhere to go): stays
        self.assertEqual(c.position(), (0, 0, 3))

    def test_slide_change_without_effects_resets(self):
        # auto advance, or a transition timer: no next was sent
        c = StepCounter(0, 2)
        c.on_next_effect()
        c.on_slide_changed(1, 0)
        self.assertEqual(c.position(), (1, 0, 0))

    def test_forward_slide_change_after_a_cancelled_prev_is_not_backwards(self):
        c = StepCounter(1, 2)
        c.on_prev_effect()  # asked at step 0 ...
        c.on_next_effect()  # ... then forward again before the change was seen
        c.on_slide_changed(2, 3)
        self.assertEqual(c.position(), (2, 0, 3))

    def test_same_slide_updates_click_count_and_clamps_step(self):
        c = StepCounter(0, 5)
        for _ in range(4):
            c.on_next_effect()
        c.on_slide_changed(0, 2)
        self.assertEqual(c.position(), (0, 2, 2))

    def test_goto_arrives_at_step_zero(self):
        c = StepCounter(0, 3)
        c.on_next_effect()
        c.on_slide_changed(4, 2)
        self.assertEqual(c.position(), (4, 0, 2))


if __name__ == '__main__':
    unittest.main()
