import { useState } from "react";
import { 
  Newspaper, 
  Clock, 
  ExternalLink, 
  AlertTriangle, 
  Flame,
  Shield,
  BookOpen,
  Filter,
  Search
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Alert, AlertDescription } from "./ui/alert";
import { ImageWithFallback } from "./figma/ImageWithFallback";

type NewsCategory = "breaking" | "updates" | "safety" | "prevention" | "research";

interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  content: string;
  category: NewsCategory;
  source: string;
  timestamp: string;
  imageUrl?: string;
  location?: string;
  isBreaking?: boolean;
  tags: string[];
}

const mockNewsArticles: NewsArticle[] = [
  {
    id: "1",
    title: "Red Flag Warning Issued for Northern California Counties",
    summary: "National Weather Service issues critical fire weather warning with sustained winds up to 45 mph and humidity levels dropping below 15%.",
    content: "The National Weather Service has issued a Red Flag Warning for multiple Northern California counties, effective through Thursday evening. Critical fire weather conditions are expected with northeast winds 25 to 35 mph with gusts up to 45 mph. Relative humidity values will drop to 10-15% Wednesday afternoon. Any fires that develop will likely spread rapidly due to these extreme conditions.",
    category: "breaking",
    source: "National Weather Service",
    timestamp: "2 hours ago",
    location: "Northern California",
    isBreaking: true,
    tags: ["red flag warning", "weather", "california"]
  },
  {
    id: "2", 
    title: "Wildfire Near Highway 101 Contained at 15 Acres",
    summary: "Local fire crews successfully contain grassfire that threatened residential areas in Marin County.",
    content: "Firefighters have successfully contained a 15-acre wildfire that broke out near Highway 101 in Marin County this morning. The fire, which started around 10:30 AM, threatened several residential structures before being brought under control by local fire departments. No injuries were reported, and all evacuation orders have been lifted. The cause of the fire is currently under investigation.",
    category: "updates",
    source: "Marin County Fire Department",
    timestamp: "4 hours ago",
    location: "Marin County",
    isBreaking: false,
    tags: ["containment", "marin county", "highway 101"]
  },
  {
    id: "3",
    title: "New Study Shows AI Wildfire Detection Reduces Response Time by 60%",
    summary: "Researchers demonstrate significant improvements in early fire detection using satellite imagery and machine learning algorithms.",
    content: "A groundbreaking study published in Nature Communications reveals that AI-powered wildfire detection systems can reduce emergency response times by up to 60%. The system uses satellite imagery and machine learning algorithms to identify fire signatures within minutes of ignition, compared to traditional detection methods that can take hours. The technology is being piloted in high-risk areas across California and Oregon.",
    category: "research", 
    source: "Nature Communications",
    timestamp: "1 day ago",
    isBreaking: false,
    tags: ["AI", "technology", "detection", "research"]
  },
  {
    id: "4",
    title: "Essential Home Fire Safety Tips for Wildfire Season",
    summary: "Fire safety experts share critical steps homeowners can take to protect their properties during high-risk periods.",
    content: "As wildfire season intensifies, fire safety experts emphasize the importance of creating defensible space around homes. Key recommendations include maintaining a 30-foot clearance zone, installing ember-resistant vents, and keeping gutters clean. Homeowners should also prepare emergency evacuation kits and establish family communication plans. Regular maintenance of vegetation and removal of flammable materials can significantly reduce fire risk.",
    category: "safety",
    source: "CAL FIRE",
    timestamp: "2 days ago",
    isBreaking: false,
    tags: ["safety", "prevention", "homeowners", "defensible space"]
  },
  {
    id: "5",
    title: "Fire Weather Watch Extended Through Weekend",
    summary: "Hot, dry conditions with elevated fire danger expected to persist across the region through Sunday.",
    content: "The National Weather Service has extended the Fire Weather Watch through Sunday evening as hot, dry conditions persist across the region. Temperatures are expected to reach 95-105°F with relative humidity dropping to 8-15%. Light offshore winds will develop Saturday night into Sunday morning. Residents are urged to avoid outdoor activities that could spark fires and report any smoke immediately.",
    category: "updates",
    source: "National Weather Service",
    timestamp: "6 hours ago",
    isBreaking: false,
    tags: ["fire weather", "extended forecast", "temperatures"]
  },
  {
    id: "6",
    title: "New Firefighting Drone Technology Deployed in Sonoma County",
    summary: "Advanced thermal imaging drones provide real-time fire monitoring and mapping capabilities for emergency crews.",
    content: "Sonoma County Fire Department has deployed new thermal imaging drone technology to enhance firefighting capabilities. The drones provide real-time fire perimeter mapping, hotspot identification, and personnel safety monitoring. This technology allows incident commanders to make more informed decisions and allocate resources more effectively. The system has already proven valuable in monitoring several small fires this season.",
    category: "research",
    source: "Sonoma County Fire Department", 
    timestamp: "3 days ago",
    isBreaking: false,
    tags: ["drones", "technology", "thermal imaging", "sonoma county"]
  }
];

export function FireNews() {
  const [selectedCategory, setSelectedCategory] = useState<NewsCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null);

  const categories = [
    { id: "all" as const, label: "All News", icon: Newspaper },
    { id: "breaking" as const, label: "Breaking", icon: AlertTriangle },
    { id: "updates" as const, label: "Updates", icon: Flame },
    { id: "safety" as const, label: "Safety", icon: Shield },
    { id: "research" as const, label: "Research", icon: BookOpen }
  ];

  const filteredArticles = mockNewsArticles.filter(article => {
    const matchesCategory = selectedCategory === "all" || article.category === selectedCategory;
    const matchesSearch = searchQuery === "" || 
      article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      article.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
      article.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()));
    
    return matchesCategory && matchesSearch;
  });

  const getCategoryBadge = (category: NewsCategory) => {
    const configs = {
      breaking: { label: "Breaking", className: "bg-red-100 text-red-800 border-red-200" },
      updates: { label: "Updates", className: "bg-orange-100 text-orange-800 border-orange-200" },
      safety: { label: "Safety", className: "bg-green-100 text-green-800 border-green-200" },
      prevention: { label: "Prevention", className: "bg-blue-100 text-blue-800 border-blue-200" },
      research: { label: "Research", className: "bg-purple-100 text-purple-800 border-purple-200" }
    };
    
    const config = configs[category];
    return (
      <Badge variant="outline" className={config.className}>
        {config.label}
      </Badge>
    );
  };

  const breakingNews = mockNewsArticles.filter(article => article.isBreaking);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold mb-2">Fire News & Updates</h1>
          <p className="text-muted-foreground">
            Latest wildfire news, safety updates, and emergency information
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm">
            <ExternalLink className="h-4 w-4 mr-2" />
            View External Sources
          </Button>
        </div>
      </div>

      {/* Breaking News Alert */}
      {breakingNews.length > 0 && (
        <Alert className="border-l-4 border-l-red-500 bg-red-50">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <div className="flex items-center justify-between">
              <div>
                <strong>Breaking:</strong> {breakingNews[0].title}
              </div>
              <Badge className="bg-red-100 text-red-800 border-red-200 animate-pulse">
                Live
              </Badge>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Search and Filter Controls */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search fire news..." 
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {categories.map((category) => {
                const Icon = category.icon;
                return (
                  <Button
                    key={category.id}
                    variant={selectedCategory === category.id ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedCategory(category.id)}
                    className="flex items-center gap-2"
                  >
                    <Icon className="h-4 w-4" />
                    {category.label}
                  </Button>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* News Articles */}
      <div className="space-y-6">
        {filteredArticles.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center">
              <Newspaper className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No articles found</h3>
              <p className="text-muted-foreground">
                Try adjusting your search criteria or category filter.
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredArticles.map((article) => (
            <Card key={article.id} className={article.isBreaking ? "border-red-200 bg-red-50/30" : ""}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {getCategoryBadge(article.category)}
                      {article.location && (
                        <Badge variant="outline" className="text-xs">
                          {article.location}
                        </Badge>
                      )}
                      {article.isBreaking && (
                        <Badge className="bg-red-100 text-red-800 border-red-200 animate-pulse">
                          Breaking
                        </Badge>
                      )}
                    </div>
                    <CardTitle className="text-xl mb-2">{article.title}</CardTitle>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {article.timestamp}
                      </div>
                      <span>•</span>
                      <span>{article.source}</span>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground mb-4">{article.summary}</p>
                
                {expandedArticle === article.id && (
                  <div className="mb-4 p-4 bg-muted/30 rounded-lg">
                    <p className="text-sm leading-relaxed">{article.content}</p>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex flex-wrap gap-1">
                    {article.tags.map((tag, index) => (
                      <Badge key={index} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExpandedArticle(
                        expandedArticle === article.id ? null : article.id
                      )}
                    >
                      {expandedArticle === article.id ? "Show Less" : "Read More"}
                    </Button>
                    <Button variant="outline" size="sm">
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Source
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Load More */}
      {filteredArticles.length > 0 && (
        <div className="text-center">
          <Button variant="outline">
            Load More Articles
          </Button>
        </div>
      )}

      {/* News Sources */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Newspaper className="h-5 w-5" />
            Trusted News Sources
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 border rounded-lg">
              <h3 className="font-medium mb-1">CAL FIRE</h3>
              <p className="text-xs text-muted-foreground">Official state fire agency</p>
            </div>
            <div className="text-center p-4 border rounded-lg">
              <h3 className="font-medium mb-1">National Weather Service</h3>
              <p className="text-xs text-muted-foreground">Weather alerts & warnings</p>
            </div>
            <div className="text-center p-4 border rounded-lg">
              <h3 className="font-medium mb-1">Local Fire Departments</h3>
              <p className="text-xs text-muted-foreground">Regional fire updates</p>
            </div>
            <div className="text-center p-4 border rounded-lg">
              <h3 className="font-medium mb-1">Emergency Services</h3>
              <p className="text-xs text-muted-foreground">Official alerts & evacuations</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}