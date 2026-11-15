<script>
    try {
        const theme = localStorage.getItem('quinta.night');
        document.documentElement.classList.toggle('night', theme === null || theme === '1');
    } catch {
        document.documentElement.classList.add('night');
    }
</script>
<style>
    @view-transition { navigation: auto; types: entry-page; }
</style>
