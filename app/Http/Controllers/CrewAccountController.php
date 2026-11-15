<?php

namespace App\Http\Controllers;

use App\Models\CrewCase;
use App\Models\CrewReport;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\View\View;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/** Connected records never enter the public demo database or the service worker cache. */
class CrewAccountController extends Controller
{
    private function assigned(Request $request): User
    {
        $user = $request->user();
        abort_unless($user && $user->mission_id && in_array($user->role, ['astronaut', 'cmo'], true), 403, 'A mission and role must be assigned to your account.');

        return $user;
    }

    private function authorizeCase(User $user, CrewCase $case): void
    {
        abort_unless($case->mission_id === $user->mission_id && ($user->role === 'cmo' || $case->user_id === $user->id), 404);
    }

    public function index(Request $request, string $page = 'today'): View
    {
        $user = $this->assigned($request);
        if ($page === 'today' && $user->role === 'cmo') {
            $page = 'reviews';
        }
        abort_if(in_array($page, ['reviews', 'teammates', 'reports', 'transmission'], true) && $user->role !== 'cmo', 403);
        $query = CrewCase::with('crew')->where('mission_id', $user->mission_id);
        if ($user->role !== 'cmo') {
            $query->where('user_id', $user->id);
        }
        $cases = $query->latest()->get();
        $crew = User::where('mission_id', $user->mission_id)->where('role', 'astronaut')->get(['id', 'name']);
        $reports = $user->role === 'cmo' ? CrewReport::where('mission_id', $user->mission_id)->latest()->get() : collect();

        return view('account', compact('user', 'page', 'cases', 'crew', 'reports'));
    }

    public function show(Request $request, CrewCase $case): View
    {
        $user = $this->assigned($request);
        $this->authorizeCase($user, $case);
        $case->load('crew');
        $history = CrewCase::where('mission_id', $user->mission_id)->where('user_id', $case->user_id)->where('kind', 'check-in')->latest()->limit(14)->get();

        return view('case', compact('user', 'case', 'history'));
    }

    public function store(Request $request): RedirectResponse
    {
        $user = $this->assigned($request);
        abort_unless($user->role === 'astronaut', 403);
        $input = $request->validate([
            'id' => ['required', 'uuid'], 'kind' => ['required', Rule::in(['check-in', 'symptom'])],
            'sleep_hours' => ['nullable', 'required_if:kind,check-in', 'integer', 'between:0,24'],
            'sleep_minutes' => ['nullable', 'required_if:kind,check-in', 'integer', 'between:0,59'],
            'drowsiness' => ['nullable', 'required_if:kind,check-in', 'integer', 'between:1,9'],
            'description' => ['nullable', 'required_if:kind,symptom', 'string', 'min:3', 'max:600'],
            'body_area' => ['nullable', 'required_if:kind,symptom', Rule::in(['Head', 'Eyes', 'Chest', 'Abdomen', 'Back', 'Left arm', 'Right arm', 'Left leg', 'Right leg', 'Skin, several areas', 'Other'])],
            'noticed_at' => ['nullable', 'required_if:kind,symptom', 'date', 'before_or_equal:now'],
            'photo' => ['nullable', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
            'photo_id' => ['nullable', 'required_with:photo', 'uuid'],
        ]);
        if ($input['kind'] === 'check-in' && (int) $input['sleep_hours'] * 60 + (int) $input['sleep_minutes'] > 1440) {
            return back()->withErrors(['sleep_hours' => 'Sleep duration cannot exceed 24 hours.'])->withInput();
        }
        // A stable client ID makes retries idempotent without ever overwriting another crew member's case.
        $existing = CrewCase::find($input['id']);
        if ($existing) {
            $this->authorizeCase($user, $existing);

            return redirect('/account/cases/'.$existing->id)->with('saved', 'Already available to your medical officer on the onboard server.');
        }
        $case = new CrewCase;
        $case->id = $input['id'];
        $case->user_id = $user->id;
        $case->mission_id = $user->mission_id;
        $case->kind = $input['kind'];
        $case->status = 'submitted';
        $case->data = collect($input)->only($case->kind === 'check-in' ? ['sleep_hours', 'sleep_minutes', 'drowsiness'] : ['description', 'body_area', 'noticed_at'])->all();
        $case->thread = [];
        if ($request->hasFile('photo') && $case->kind === 'symptom') {
            $case->photo_id = $input['photo_id'];
            $case->photo_path = $request->file('photo')->store('crew-photos', 'local');
        }
        try {
            $case->save();
        } catch (\Throwable $e) {
            if ($case->photo_path) {
                Storage::disk('local')->delete($case->photo_path);
            }
            throw $e;
        }

        return redirect('/account/cases/'.$case->id)->with('saved', 'Available to your medical officer on the onboard server. Nothing was sent to the ground.')->with('submitted_draft', $case->kind);
    }

    public function update(Request $request, CrewCase $case): RedirectResponse
    {
        $user = $this->assigned($request);
        $this->authorizeCase($user, $case);
        $input = $request->validate([
            'action' => ['required', Rule::in($user->role === 'cmo' ? ['review', 'follow-up'] : ['reply'])],
            'text' => ['required', 'string', 'min:3', 'max:600'],
            'field' => ['nullable', Rule::in(['sleep', 'drowsiness', 'description', 'photo'])],
        ]);
        DB::transaction(function () use ($case, $user, $input): void {
            $locked = CrewCase::lockForUpdate()->findOrFail($case->id);
            if ($input['action'] === 'reply') {
                abort_unless($locked->status === 'follow-up', 409, 'This follow-up is no longer open.');
            }
            $thread = $locked->thread;
            $thread[] = ['id' => (string) Str::uuid(), 'author' => $user->name, 'role' => $user->role, 'text' => $input['text'], 'action' => $input['action'], 'field' => $input['field'] ?? null, 'at' => now()->toIso8601String()];
            $locked->thread = $thread;
            $locked->status = match ($input['action']) {
                'review' => 'reviewed', 'reply' => 'answered', default => 'follow-up'
            };
            $locked->save();
        });

        return back()->with('saved', 'Saved on the onboard server.');
    }

    public function photo(Request $request, CrewCase $case): BinaryFileResponse
    {
        $this->authorizeCase($this->assigned($request), $case);
        abort_unless($case->photo_path && Storage::disk('local')->exists($case->photo_path), 404);

        return response()->file(Storage::disk('local')->path($case->photo_path), ['Cache-Control' => 'private, no-store', 'X-Content-Type-Options' => 'nosniff']);
    }

    public function report(Request $request): RedirectResponse
    {
        $user = $this->assigned($request);
        abort_unless($user->role === 'cmo', 403);
        $input = $request->validate(['crew_id' => ['required', 'integer']]);
        $crew = User::where('mission_id', $user->mission_id)->where('role', 'astronaut')->findOrFail($input['crew_id']);
        $records = CrewCase::where('mission_id', $user->mission_id)->where('user_id', $crew->id)->get();
        $report = new CrewReport;
        $report->id = (string) Str::uuid();
        $report->author_id = $user->id;
        $report->crew_id = $crew->id;
        $report->mission_id = $user->mission_id;
        $report->snapshot = ['crew' => $crew->name, 'created_at' => now()->toIso8601String(), 'cases' => $records->map(fn ($c) => ['id' => $c->id, 'kind' => $c->kind, 'status' => $c->statusLabel(), 'data' => $c->data, 'thread' => $c->thread])->all()];
        $report->save();

        return redirect('/account/reports')->with('saved', 'Report snapshot saved. Photos are excluded.');
    }

    public function queue(Request $request, CrewReport $report): RedirectResponse
    {
        $user = $this->assigned($request);
        abort_unless($user->role === 'cmo', 403);
        abort_unless($report->mission_id === $user->mission_id, 404);
        if ($report->status === 'not-queued') {
            $report->update(['status' => 'queued', 'queued_at' => now()]);
        }

        return redirect('/account/transmission')->with('saved', 'Queued on the onboard server. A ground receiver is not configured for connected accounts.');
    }
}
