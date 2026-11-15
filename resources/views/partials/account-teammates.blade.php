@php
    $today = now('UTC')->startOfDay();
    $days = collect(range(6, 0))->map(fn ($offset) => $today->copy()->subDays($offset));
    $checkins = $cases->where('kind', 'check-in')->groupBy('user_id')->map(
        fn ($entries) => $entries->groupBy(fn ($entry) => $entry->created_at->copy()->utc()->toDateString())
    );
    $todayCount = $crew->filter(fn ($member) => $checkins->get($member->id)?->has($today->toDateString()))->count();
    $watch = $cases->whereIn('status', ['submitted', 'answered']);
@endphp
<div class="teammates-summary"><span>Today · <b>{{ $todayCount }} of {{ $crew->count() }} check-ins</b></span><a href="/account/check-in">Daily Check-in →</a></div>
<div class="teammates-grid">
    <div class="cmo-board">
        <section class="card board"><div class="card-h"><h2>Crew board</h2><small>Today’s recorded values · UTC</small></div>
            <div class="table-wrap"><table><thead><tr><th scope="col">Member</th><th scope="col">Sleep</th><th scope="col">Drowsiness</th><th scope="col">Check-in</th></tr></thead><tbody>
            @forelse($crew as $member)
                @php($entry = $checkins->get($member->id)?->get($today->toDateString())?->first())
                <tr><th scope="row">@if($entry)<a href="/account/cases/{{ $entry->id }}">{{ $member->name }}</a>@else{{ $member->name }}@endif</th>
                    <td>{{ $entry ? $entry->data['sleep_hours'].' h '.$entry->data['sleep_minutes'].' min' : '—' }}</td>
                    <td>{{ $entry ? $entry->data['drowsiness'].'/9' : '—' }}</td>
                    <td>{{ $entry ? $entry->created_at->copy()->utc()->format('H:i') : 'No submission today' }}</td></tr>
            @empty<tr><td colspan="4">No astronauts are assigned to this mission.</td></tr>@endforelse
            </tbody></table></div>
        </section>
        <section class="card"><div class="card-h"><h2>Crew sleep · 7 nights</h2><small>Sleep diary</small></div>
            <div class="table-wrap"><table><thead><tr><th scope="col">Member</th>@foreach($days as $day)<th scope="col">{{ $day->format('M j') }}</th>@endforeach</tr></thead><tbody>
            @foreach($crew as $member)
                <tr><th scope="row">{{ $member->name }}</th>@foreach($days as $day)
                    @php($entry = $checkins->get($member->id)?->get($day->toDateString())?->first())
                    <td>{{ $entry ? $entry->data['sleep_hours'].'h'.str_pad((string) $entry->data['sleep_minutes'], 2, '0', STR_PAD_LEFT) : '—' }}</td>
                @endforeach</tr>
            @endforeach
            </tbody></table></div>
        </section>
    </div>
    <section class="card teammates-watch"><div class="card-h"><h2>Duty watch</h2><small>{{ $watch->count() }} open</small></div>
        <ul class="watch-list">@forelse($watch as $case)<li><a href="/account/cases/{{ $case->id }}"><span><b>{{ $case->crew->name }}</b><small>{{ $case->statusLabel() }}</small></span><span aria-hidden="true">→</span></a></li>
        @empty<li>No reviews waiting.</li>@endforelse</ul>
    </section>
</div>
