import React from 'react';
import { Piano, getMidiNumberAttributes } from 'react-piano';
import classNames from 'classnames';
import _ from 'lodash';

import Composer from './Composer';
import DimensionsProvider from './DimensionsProvider';
import KEYBOARD_CONFIGS from './keyboardConfigs';
import { getKeyboardShortcutMapping } from './keyboardShortcuts';
import InputManager from './InputManager';
import Oscillator from './Oscillator';
import SAMPLE_SONGS from './sampleSongs';

// TODO: move note recording logic to separate helper file
class PianoComposer extends React.Component {
  constructor(props) {
    super(props);

    // TODO: split state into multiple components
    this.state = {
      isPlaying: false,
      isRecording: true,
      notes: [],
      notesRecorded: false,
      notesArray: [],
      notesArrayIndex: 0,
      noteEvents: [],
      input: {
        isMouseDown: false,
      },
    };

    this.oscillator = new Oscillator({
      audioContext: props.audioContext,
      gain: 0.1,
    });

    this.playbackIntervalHandler = null;
  }

  getActiveNotes = () => {
    // Returns playback notes, or currently active notes from user input
    return this.state.isPlaying
      ? this.state.notesArray[this.state.notesArrayIndex]
      : this.state.notes;
  };

  // TODO: refactor
  getShiftedNotesArrayIndex = (value, base) => {
    if (base === 0) {
      return 0;
    }
    return (this.state.notesArrayIndex + value + base) % base; // Need to add base to prevent negative numbers
  };

  // TODO dedupe
  getMidiNumbers() {
    return _.range(this.props.startNote, this.props.endNote + 1);
  }

  getMidiNumberForKey = (key) => {
    const mapping = getKeyboardShortcutMapping(this.getMidiNumbers(), KEYBOARD_CONFIGS.MIDDLE);
    return mapping[key];
  };

  getKeyForMidiNumber = (midiNumber) => {
    const mapping = getKeyboardShortcutMapping(this.getMidiNumbers(), KEYBOARD_CONFIGS.MIDDLE);
    for (let key in mapping) {
      if (mapping[key] === midiNumber) {
        return key;
      }
    }
    return null;
  };

  loadNotes = (notesArray) => {
    this.setState({
      notesArray,
      notesArrayIndex: notesArray.length - 1,
    });
  };

  onRecordNotes = (midiNumbers) => {
    if (this.state.isRecording) {
      const notesArrayCopy = this.state.notesArray.slice();
      notesArrayCopy.splice(this.state.notesArrayIndex + 1, 0, midiNumbers);
      this.setState({
        notesArray: notesArrayCopy,
        notesArrayIndex: this.getShiftedNotesArrayIndex(1, notesArrayCopy.length),
      });
    }
  };

  onAddRest = () => {
    this.onRecordNotes([]);
  };

  onDeleteNote = () => {
    if (!this.state.isPlaying) {
      // Delete note at notesArrayIndex
      const notesArrayCopy = this.state.notesArray.slice();
      notesArrayCopy.splice(this.state.notesArrayIndex, 1);
      this.setState({
        notesArray: notesArrayCopy,
        notesArrayIndex: this.getShiftedNotesArrayIndex(-1, notesArrayCopy.length),
      });
    }
  };

  onStepBackward = () => {
    this.setState({
      notesArrayIndex: this.getShiftedNotesArrayIndex(-1, this.state.notesArray.length),
    });
  };

  onStepForward = () => {
    this.setState({
      notesArrayIndex: this.getShiftedNotesArrayIndex(1, this.state.notesArray.length),
    });
  };

  onClear = () => {
    this.onStop();
    this.setState({
      notesArray: [],
      notesArrayIndex: 0,
    });
  };

  onPlay = (notesArray) => {
    if (this.state.isPlaying) {
      return;
    }
    this.setState({
      isPlaying: true,
      isRecording: false,
    });
    // TODO: configurable playback timing
    this.playbackIntervalHandler = setInterval(() => {
      this.setState({
        notesArrayIndex: this.getShiftedNotesArrayIndex(1, this.state.notesArray.length),
      });
    }, 250);
  };

  onStop = () => {
    clearInterval(this.playbackIntervalHandler);
    // Trigger residual notes that have started playing, to stop playing.
    // Otherwise, there's usually a lingering note.
    this.props.onStopAll();
    this.setState({
      isPlaying: false,
      isRecording: true,
      notesArrayIndex: this.state.notesArray.length - 1, // Set this to end of composition so can keep writing
    });
  };

  onKeyDown = (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const midiNumber = this.getMidiNumberForKey(event.key);
    if (midiNumber) {
      this.onNoteDown(midiNumber);
    } else if (event.key === '-') {
      this.onAddRest();
    } else if (event.key === 'Backspace') {
      this.onDeleteNote();
    } else if (event.key === 'ArrowLeft') {
      this.onStepBackward();
    } else if (event.key === 'ArrowRight') {
      this.onStepForward();
    }
  };

  onKeyUp = (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const midiNumber = this.getMidiNumberForKey(event.key);
    if (midiNumber) {
      this.onNoteUp(midiNumber);
    }
  };

  onNoteDown = (midiNumber) => {
    if (this.props.isLoading) {
      return;
    }
    if (this.state.isPlaying) {
      this.props.onNoteDown(midiNumber);
    } else {
      // Prevent duplicate note firings
      const alreadyFired = this.state.notes.includes(midiNumber);
      if (alreadyFired) {
        return;
      }
      this.props.onNoteDown(midiNumber);
      // Only set notes for user input, not programmatic firings
      this.setState((prevState) => ({
        notes: prevState.notes.concat(midiNumber).sort(),
        // Initiate a new batch of notes if a chord is being played
        notesRecorded: false,
        /* TODO recording raw events
        noteEvents: this.state.noteEvents.concat({
          type: 'NOTE_START',
          time: this.props.audioContext.currentTime,
          midiNumber: midiNumber,
        }),
        */
      }));
    }
  };

  onNoteUp = (midiNumber) => {
    if (this.props.isLoading) {
      return;
    }
    if (this.state.isPlaying) {
      this.props.onNoteUp(midiNumber);
    } else {
      const alreadyFired = !this.state.notes.includes(midiNumber);
      if (alreadyFired) {
        return;
      }
      this.props.onNoteUp(midiNumber);

      // Recording logic
      // When playing a chord, record when the first note is released, and
      // stop recording subsequent note releases, UNLESS a new note is added
      const willRecord = this.state.notesRecorded === false;
      if (willRecord) {
        this.onRecordNotes(this.state.notes);
      }

      // Only set notes for user input, not programmatic firings
      this.setState((prevState) => ({
        notes: prevState.notes.filter((note) => midiNumber !== note),
        notesRecorded: prevState.notesRecorded || willRecord,
        /* TODO recording raw events
        noteEvents: prevState.noteEvents.concat({
          type: 'NOTE_END',
          time: this.props.audioContext.currentTime,
          midiNumber: midiNumber,
        }),
        */
      }));
    }
  };

  onMouseDown = () => {
    this.setState({
      input: Object.assign({}, this.state.input, {
        isMouseDown: true,
      }),
    });
  };

  onMouseUp = () => {
    this.setState({
      input: Object.assign({}, this.state.input, {
        isMouseDown: false,
      }),
    });
  };

  renderNoteLabel = (midiNumber) => {
    const keyboardShortcut = this.getKeyForMidiNumber(midiNumber);
    if (!keyboardShortcut) {
      return null;
    }
    const { isAccidental } = getMidiNumberAttributes(midiNumber);
    return (
      <div className="text-center">
        <div
          className={classNames({
            'NoteLabel--black': isAccidental,
            'NoteLabel--white': !isAccidental,
          })}
        >
          {keyboardShortcut}
        </div>
      </div>
    );
  };

  render() {
    return (
      <div>
        <InputManager
          onKeyDown={this.onKeyDown}
          onKeyUp={this.onKeyUp}
          onMouseDown={this.onMouseDown}
          onMouseUp={this.onMouseUp}
        />
        <div>
          <DimensionsProvider>
            {(width) => (
              <Piano
                startNote={this.props.startNote}
                endNote={this.props.endNote}
                notes={this.getActiveNotes()}
                disabled={this.props.isLoading}
                width={width}
                gliss={this.state.input.isMouseDown}
                renderNoteLabel={this.renderNoteLabel}
                onNoteDown={this.onNoteDown}
                onNoteUp={this.onNoteUp}
              />
            )}
          </DimensionsProvider>
        </div>
        <Composer
          className="Composer mt-3"
          isPlaying={this.state.isPlaying}
          notesArray={this.state.notesArray}
          notesArrayIndex={this.state.notesArrayIndex}
          onAddRest={this.onAddRest}
          onDeleteNote={this.onDeleteNote}
          onClear={this.onClear}
          onPlay={this.onPlay}
          onStop={this.onStop}
          onStepForward={this.onStepForward}
          onStepBackward={this.onStepBackward}
        />
      </div>
    );
  }
}

export default PianoComposer;
