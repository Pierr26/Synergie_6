@extends('layouts.account')
@section('title', ['today'=>'Today','check-in'=>'Daily Check-in','reviews'=>'Review queue','teammates'=>'Team','trends'=>'Trends','body'=>'Body & Risks','symptoms'=>'Report a Symptom','follow-up'=>'Follow-up','reports'=>'Reports','transmission'=>'Ground transmission'][$page])
@section('content')
@php
    $follow = $cases->firstWhere('status', 'follow-up');
    $todayCheckin = $cases->first(fn($c) => $c->kind === 'check-in' && $c->created_at->isToday());
    $pending = $cases->first(fn($c) => in_array($c->status, ['submitted','answered']));
@endphp
@if($page === 'today')
<section class="today-hero"><div class="today-copy"><span class="mission-kicker">YOUR NEXT STEP</span>
    <h2>{{ $follow ? 'Respond to follow-up' : (!$todayCheckin ? 'A moment for your health.' : ($pending ? 'Crew review pending' : 'Your check-in is saved.')) }}</h2>
    <p>{{ $follow ? collect($follow->thread)->last()['text'] : (!$todayCheckin ? 'Sleep duration and drowsiness first. About one minute.' : 'Your check-in is saved on the onboard server and available to your medical officer.') }}</p>
    @if($follow || ($pending && $todayCheckin))
        <a class="btn btn-primary" href="{{ '/account/cases/'.($follow ? $follow->id.'#response' : $pending->id) }}">{{ $follow ? 'Respond to follow-up' : 'Track crew review' }}</a>
    @endif
</div><figure class="today-window"><img src="/assets/illustrations/lunar-window.webp" width="1200" height="800" alt="Illustrated lunar window"><figcaption>HEXTA · mission illustration</figcaption></figure></section>
<nav class="journey-links" aria-label="Other available actions"><a class="journey-link" href="/account/symptoms">Report a Symptom</a><a class="journey-link" href="/account/follow-up">Follow-up</a></nav>
@endif
@if($page === 'check-in' || $page === 'symptoms')
@if($user->role !== 'astronaut')
    @if($page === 'check-in')
        <section class="card"><h2>On-board check-ins</h2>
        @forelse($cases->where('kind', 'check-in') as $case)
            <a class="review-row" href="/account/cases/{{ $case->id }}"><span><b>{{ $case->crew->name }}</b><span>{{ $case->data['sleep_hours'] }} h {{ $case->data['sleep_minutes'] }} min · Drowsiness {{ $case->data['drowsiness'] }}/9</span><small>{{ $case->created_at->format('Y-m-d H:i') }} UTC</small></span><span class="badge badge-info">{{ $case->statusLabel() }}</span></a>
        @empty<p>No check-in submitted yet.</p>@endforelse
        </section>
    @else
        <p class="card">Open a crew member’s case to review their observations.</p>
    @endif
@else
<form class="card" method="post" action="/account/cases" enctype="multipart/form-data" data-account-draft="{{ $page === 'check-in' ? 'check-in' : 'symptom' }}">@csrf
    <input type="hidden" name="id" value="{{ old('id', (string) Illuminate\Support\Str::uuid()) }}"><input type="hidden" name="kind" value="{{ $page === 'check-in' ? 'check-in' : 'symptom' }}">
    <h2>{{ $page === 'check-in' ? 'How did you sleep?' : 'Describe what you see.' }}</h2><p class="draft-status" role="status" data-draft-status>Saving your draft on this device…</p>
    @if($page === 'check-in')
    <div class="grid-2"><div class="field"><label for="sleep_hours">Hours asleep</label><input id="sleep_hours" type="number" name="sleep_hours" min="0" max="24" required value="{{ old('sleep_hours') }}"></div><div class="field"><label for="sleep_minutes">Minutes</label><input id="sleep_minutes" type="number" name="sleep_minutes" min="0" max="59" required value="{{ old('sleep_minutes',0) }}"></div></div>
    <div class="field"><label for="drowsiness">Drowsiness now · 1 wide awake, 9 struggling to stay awake</label><select name="drowsiness" id="drowsiness" required><option value="">Choose</option>@for($i=1;$i<=9;$i++)<option value="{{ $i }}" @selected(old('drowsiness') == $i)>{{ $i }}</option>@endfor</select></div>
    @else
    <div class="field"><label for="description">What do you see?</label><textarea id="description" name="description" rows="4" minlength="3" maxlength="600" required>{{ old('description') }}</textarea></div>
    <div class="field"><label for="body_area">Body area</label><select id="body_area" name="body_area" required><option value="">Choose</option>@foreach(['Head','Eyes','Chest','Abdomen','Back','Left arm','Right arm','Left leg','Right leg','Skin, several areas','Other'] as $area)<option @selected(old('body_area') === $area)>{{ $area }}</option>@endforeach</select></div>
    <div class="field"><label for="noticed_at">When did you notice it? (UTC)</label><input id="noticed_at" name="noticed_at" type="datetime-local" value="{{ old('noticed_at', now()->format('Y-m-d\TH:i')) }}" required></div>
    <input type="hidden" name="photo_id" value="{{ old('photo_id', (string) Illuminate\Support\Str::uuid()) }}">
    <div class="field" id="photo"><label for="photo-file">Photo (optional) · JPEG, PNG or WebP, up to 5 MB</label><input id="photo-file" type="file" name="photo" accept="image/jpeg,image/png,image/webp"><label for="camera-file">Or take a photo</label><input id="camera-file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-account-camera><figure hidden data-account-preview><img class="account-photo" alt="Preview of the attached photo"><figcaption data-photo-caption></figcaption></figure><button hidden type="button" class="btn btn-ghost" data-remove-photo>Remove photo</button></div>
    @endif
    <button class="btn btn-primary" type="submit">{{ $page === 'check-in' ? 'Save check-in on board' : 'Submit for onboard review' }}</button>
    <p class="fine">The draft stays on this device. Submitting requires the onboard server; the ground link is separate. No automatic ground transmission.</p>
</form>
@endif
@endif
@if($page === 'teammates') @include('partials.account-teammates') @endif
@if($page === 'reviews' || $page === 'follow-up')
<section class="card"><h2>{{ $page === 'reviews' ? 'Cases to review' : 'Requests, responses & reviews' }}</h2>
@forelse($cases->sortBy(fn($c) => $c->status === 'reviewed' ? 2 : ($c->status === 'follow-up' ? 1 : 0)) as $case)
<a class="review-row" href="/account/cases/{{ $case->id }}"><span><b>{{ $case->crew->name }}</b><span>{{ $case->kind === 'check-in' ? 'Daily check-in · sleep & drowsiness' : $case->data['body_area'].' · '.$case->data['description'] }}</span><small class="mono">{{ $case->created_at->format('Y-m-d H:i') }} UTC</small></span><span class="badge badge-{{ $case->status === 'reviewed' ? 'ok' : 'info' }}">{{ $case->statusLabel() }}</span></a>
@empty<p>No case yet. Submitted observations and follow-up responses appear here.</p>@endforelse</section>
@endif
@if($page === 'trends')
<section class="card"><h2>Recorded sleep & drowsiness</h2><p>Values keep their date and source. Missing days are not filled.</p><div class="table-wrap"><table><thead><tr><th>Member</th><th>Date · UTC</th><th>Sleep</th><th>Drowsiness</th><th>Source</th></tr></thead><tbody>
@forelse($cases->where('kind','check-in') as $case)<tr><td>{{ $case->crew->name }}</td><td><a href="/account/cases/{{ $case->id }}">{{ $case->created_at->format('Y-m-d H:i') }}</a></td><td>{{ $case->data['sleep_hours'] }} h {{ $case->data['sleep_minutes'] }} min</td><td>{{ $case->data['drowsiness'] }} / 9</td><td>Manual crew entry · sleep diary</td></tr>@empty<tr><td colspan="5">No measurements recorded.</td></tr>@endforelse
</tbody></table></div></section>
@endif
@if($page === 'body')
<section class="card"><h2>Explore a body region</h2><p>Educational mission references. These sheets are independent of your measurements.</p><div class="grid-2"><img src="/assets/illustrations/body-front.webp" alt="Illustrated body, front view" width="320" height="450"><div>
@foreach(['Head & eyes'=>'Sleep, drowsiness and visual changes','Heart & circulation'=>'Rest context, heart rate and blood pressure','Lungs'=>'Breathing and oxygen measurements','Muscles & bones'=>'Mobility, exercise and changes in microgravity','Skin'=>'Visible signs, skin changes and optional photos'] as $region=>$description)<details class="card"><summary>{{ $region }}</summary><p>{{ $description }}</p><p>Record what you observe and ask your medical officer for review.</p><a href="/account/symptoms">Report a Symptom</a></details>@endforeach
<p><a href="https://www.nasa.gov/hrp/hazards/" target="_blank" rel="noopener">NASA Human Research Program · mission hazards</a></p><a class="btn btn-ghost" href="/body">Open the interactive 2D / optional 3D demo</a><p class="fine">The interactive anatomy uses the separate fictional demo workspace.</p></div></div></section>
@endif
@if($page === 'reports' || $page === 'transmission')
@if($page === 'reports')<section class="card"><h2>Prepare an individual report</h2><form method="post" action="/account/reports">@csrf<div class="field"><label for="crew_id">Crew member</label><select id="crew_id" name="crew_id">@foreach($crew as $member)<option value="{{ $member->id }}">{{ $member->name }}</option>@endforeach</select></div><button class="btn btn-primary">Generate snapshot</button></form><p class="fine">Frozen observations and review history. Photos are excluded.</p></section>@endif
<section class="card"><h2>{{ $page === 'reports' ? 'Reports' : 'Ground transmission queue' }}</h2><p>Connected accounts have no configured ground receiver. Queued reports stay on the onboard server; no receipt is claimed.</p>
@forelse($reports as $report)<article class="account-report"><p><b>{{ $report->snapshot['crew'] }}</b> · {{ $report->created_at->format('Y-m-d H:i') }} UTC <span class="badge badge-info">{{ $report->status === 'queued' ? 'Queued for ground' : 'Not queued' }}</span></p><details><summary>Report {{ $report->id }}</summary><pre>{{ json_encode($report->snapshot, JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES) }}</pre></details>@if($report->status === 'not-queued')<form method="post" action="/account/reports/{{ $report->id }}/queue">@csrf<button class="btn btn-ghost">Queue for ground</button></form>@endif</article>@empty<p>No report generated yet.</p>@endforelse</section>
@endif
@endsection
